// Mate assistant — token-usage + cost recorder and admin query surface.
//
// Two write paths feed `users/{uid}/assistantUsage/{yyyymmdd}`:
//   1. `recordChatUsage` — called from assistantChat after every Gemini
//      generateContent reply. Reads usageMetadata verbatim from Gemini and
//      converts it to USD micros using PRICING below.
//   2. `reportAssistantLiveUsage` (callable) — the RN client posts the Live
//      WebSocket's per-turn usageMetadata frames here. The server can't see
//      them directly because the WS runs device→Gemini with an ephemeral
//      token, so this is the only way to know what voice actually cost.
//
// `adminAssistantCosts` is the read side for /admin/ai-costs. It scans the
// `assistantUsage` collectionGroup over a date window, rolls daily totals, and
// returns top spenders. Pricing constants can be tweaked here without a
// migration — they're applied at write time, so historical rows keep their
// original cost; only new writes pick up the change.

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import {
  settleVoiceSecondsUpdate,
  MAX_SESSION_SECONDS,
  Plan,
} from './assistantQuota.helpers';

const db = () => admin.firestore();

// ---------------------------------------------------------------------------
// Pricing (USD per 1M tokens). Preview model rates — update here when Google
// publishes GA pricing. costMicros = tokens / 1_000_000 * pricePerM * 1_000_000
// = tokens * pricePerM, so we store integer micros and divide by 1e6 on read.
// ---------------------------------------------------------------------------

export interface ModelPricing {
  /** USD per 1M input (text) tokens. */
  inputPerM: number;
  /** USD per 1M output (text) tokens. Thoughts tokens are billed at this rate. */
  outputPerM: number;
  /** USD per 1M cached input tokens (context cache hit). */
  cachedInputPerM: number;
  /** USD per 1M cache-WRITE input tokens. Claude bills writes at a premium
   *  over plain input; unset means writes bill at inputPerM (Gemini). */
  cacheWritePerM?: number;
  /** USD per 1M input audio tokens. Only set for Live audio models. */
  inputAudioPerM?: number;
  /** USD per 1M output audio tokens. Only set for Live audio models. */
  outputAudioPerM?: number;
  /**
   * USD per MINUTE of connected conversation. Set only for per-minute platforms
   * (ElevenLabs Agents), where audio is not billed per token at all.
   *
   * NOTE the unit change. Every other field here exploits the fact that
   * tokens * pricePerM already equals micros; a per-minute rate is plain USD
   * and has to be multiplied by 1e6 explicitly. See platformCostMicros.
   */
  perMinuteUsd?: number;
  /** USD per minute when over the concurrency limit (burst rate). */
  burstPerMinuteUsd?: number;
}

export const PRICING: Record<string, ModelPricing> = {
  // Text chat model used by assistantChat.
  'gemini-3-flash-preview': {
    inputPerM: 0.30,
    outputPerM: 2.50,
    cachedInputPerM: 0.075,
  },
  // Text chat brain since Aug 2026 (see assistantChat CHAT_PROVIDER).
  // Standard Sonnet 5 rates — the $2/$10 intro window ends 2026-08-31, so
  // record at the post-intro price rather than under-counting from day one.
  'claude-sonnet-5': {
    inputPerM: 3.00,
    outputPerM: 15.00,
    cachedInputPerM: 0.30,
    cacheWritePerM: 3.75,
  },
  // Voice via an ElevenLabs Agent running Claude Sonnet 5.
  //
  // The key is compound on purpose. The text path already writes
  // models.claude-sonnet-5.* on the same daily doc; sharing the key would fuse
  // typing spend and talking spend so /admin/ai-costs couldn't tell you which
  // one is costing money. sanitiseKey turns the slash into an underscore for
  // the Firestore field path, while pricingFor looks up the raw key.
  //
  // LLM tokens are billed by ElevenLabs and deducted from their credits, so the
  // token rates below are for reconciliation against their charging breakdown,
  // not for a bill we pay Anthropic directly.
  'elevenlabs/claude-sonnet-5': {
    inputPerM: 3.00,
    outputPerM: 15.00,
    cachedInputPerM: 0.30,
    cacheWritePerM: 3.75,
    perMinuteUsd: 0.08,
    burstPerMinuteUsd: 0.16,
  },
  // Voice Live model used by assistantToken → client WS.
  'gemini-3.1-flash-live-preview': {
    inputPerM: 0.30,
    outputPerM: 2.50,
    cachedInputPerM: 0.075,
    inputAudioPerM: 0.50,
    outputAudioPerM: 2.00,
  },
};

function pricingFor(model: string): ModelPricing {
  return PRICING[model] || PRICING['gemini-3-flash-preview'];
}

export function todayKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Chat recording — called by assistantChat for every generateContent reply.
// ---------------------------------------------------------------------------

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  /** Claude only (mapped by claudeChatAdapter) — prompt tokens that were
   *  WRITTEN to cache this call, billed above the plain input rate. */
  cacheWriteTokenCount?: number;
}

export function costMicrosForChat(model: string, u: GeminiUsageMetadata): number {
  const p = pricingFor(model);
  const promptTotal = u.promptTokenCount || 0;
  const cached = u.cachedContentTokenCount || 0;
  const cacheWrite = u.cacheWriteTokenCount || 0;
  const billedInput = Math.max(0, promptTotal - cached - cacheWrite);
  const output = u.candidatesTokenCount || 0;
  const thoughts = u.thoughtsTokenCount || 0;
  // Gemini bills thoughts at the output rate (they're model-generated tokens).
  const usd =
    (billedInput * p.inputPerM) +
    (cached * p.cachedInputPerM) +
    (cacheWrite * (p.cacheWritePerM ?? p.inputPerM)) +
    ((output + thoughts) * p.outputPerM);
  return Math.round(usd); // tokens * pricePerM already = micros
}

/**
 * Record a text-chat turn's token usage onto the user's daily counter and the
 * global daily roll-up. Idempotency is best-effort: this is called once per
 * model reply, and on retries the duplicate write just inflates counters
 * slightly — acceptable for billing dashboards (not invoicing).
 */
export async function recordChatUsage(opts: {
  uid: string;
  model: string;
  usage: GeminiUsageMetadata;
  countedTurn: boolean;
}): Promise<{ costMicros: number }> {
  const { uid, model, usage } = opts;
  // countedTurn currently informational; turns counter is owned by assistantToken.
  void opts.countedTurn;
  const costMicros = costMicrosForChat(model, usage);
  const date = todayKey();
  const inc = admin.firestore.FieldValue.increment;
  const userRef = db().doc(`users/${uid}/assistantUsage/${date}`);
  const globalRef = db().doc(`assistantCostsDaily/${date}`);

  const patch = {
    chatCalls: inc(1),
    inputTokens: inc(usage.promptTokenCount || 0),
    outputTokens: inc(usage.candidatesTokenCount || 0),
    thoughtsTokens: inc(usage.thoughtsTokenCount || 0),
    cachedTokens: inc(usage.cachedContentTokenCount || 0),
    costMicros: inc(costMicros),
    [`models.${sanitiseKey(model)}.calls`]: inc(1),
    [`models.${sanitiseKey(model)}.costMicros`]: inc(costMicros),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  } as Record<string, unknown>;

  await Promise.all([
    userRef.set(patch, { merge: true }),
    globalRef.set(
      {
        ...patch,
        // Global doc also tracks distinct active users per day via a probe.
        [`activeUsers.${uid}`]: true,
        date,
      },
      { merge: true },
    ),
  ]);

  return { costMicros };
}

function sanitiseKey(model: string): string {
  return model.replace(/[.#$/[\]]/g, '_');
}

// ---------------------------------------------------------------------------
// Voice (Live API) recording — invoked by the RN client, which is the only
// party that sees Live usageMetadata frames.
// ---------------------------------------------------------------------------

interface LiveUsagePayload {
  model?: string;
  inputTextTokens?: number;
  outputTextTokens?: number;
  inputAudioTokens?: number;
  outputAudioTokens?: number;
  cachedTokens?: number;
  thoughtsTokens?: number;
  sessionEnded?: boolean;
}

export function costMicrosForLive(model: string, u: LiveUsagePayload): number {
  const p = pricingFor(model);
  const billedInputText = Math.max(0, (u.inputTextTokens || 0) - (u.cachedTokens || 0));
  const usd =
    (billedInputText * p.inputPerM) +
    ((u.cachedTokens || 0) * p.cachedInputPerM) +
    ((u.outputTextTokens || 0) * p.outputPerM) +
    ((u.thoughtsTokens || 0) * p.outputPerM) +
    ((u.inputAudioTokens || 0) * (p.inputAudioPerM ?? p.inputPerM)) +
    ((u.outputAudioTokens || 0) * (p.outputAudioPerM ?? p.outputPerM));
  return Math.round(usd);
}

/**
 * Platform (connection-time) cost of a voice session, in micros.
 *
 * THE UNIT TRAP: every other cost term in this file relies on
 * `tokens * pricePerM === micros`, because pricePerM is USD per 1,000,000
 * tokens. A per-minute rate is plain USD per minute and needs an explicit
 * * 1e6. Getting this wrong is a factor-of-a-million error that looks
 * completely plausible on a dashboard. Pinned by test: 6 minutes at $0.08/min
 * is exactly 480_000 micros.
 *
 * Returns 0 for models with no per-minute rate, so the Gemini rows keep costing
 * exactly what they always did.
 */
export function platformCostMicros(
  model: string,
  durationSeconds: number,
  opts: { burst?: boolean } = {},
): number {
  const p = pricingFor(model);
  const rate = opts.burst ? (p.burstPerMinuteUsd ?? p.perMinuteUsd) : p.perMinuteUsd;
  if (!rate) return 0;
  const seconds = Math.max(0, durationSeconds || 0);
  return Math.round((seconds / 60) * rate * 1_000_000);
}

export const reportAssistantLiveUsage = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');

  const payload: LiveUsagePayload = data || {};
  const model = String(payload.model || 'gemini-3.1-flash-live-preview');
  // Clamp to defensible bounds — a misbehaving client shouldn't be able to
  // poison the cost dashboard. 5M tokens in a single report is already ~1h
  // of Live audio; anything bigger is almost certainly a bug.
  const CAP = 5_000_000;
  const clamp = (n: unknown) => Math.max(0, Math.min(CAP, Math.floor(Number(n) || 0)));
  const usage: LiveUsagePayload = {
    inputTextTokens: clamp(payload.inputTextTokens),
    outputTextTokens: clamp(payload.outputTextTokens),
    inputAudioTokens: clamp(payload.inputAudioTokens),
    outputAudioTokens: clamp(payload.outputAudioTokens),
    cachedTokens: clamp(payload.cachedTokens),
    thoughtsTokens: clamp(payload.thoughtsTokens),
  };
  const costMicros = costMicrosForLive(model, usage);
  const date = todayKey();
  const inc = admin.firestore.FieldValue.increment;
  const sessionDelta = payload.sessionEnded ? 1 : 0;

  const patch = {
    voiceInputTextTokens: inc(usage.inputTextTokens || 0),
    voiceOutputTextTokens: inc(usage.outputTextTokens || 0),
    voiceInputAudioTokens: inc(usage.inputAudioTokens || 0),
    voiceOutputAudioTokens: inc(usage.outputAudioTokens || 0),
    voiceThoughtsTokens: inc(usage.thoughtsTokens || 0),
    voiceCachedTokens: inc(usage.cachedTokens || 0),
    voiceSessions: inc(sessionDelta),
    costMicros: inc(costMicros),
    [`models.${sanitiseKey(model)}.voiceCostMicros`]: inc(costMicros),
    [`models.${sanitiseKey(model)}.voiceSessions`]: inc(sessionDelta),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  } as Record<string, unknown>;

  await Promise.all([
    db().doc(`users/${uid}/assistantUsage/${date}`).set(patch, { merge: true }),
    db().doc(`assistantCostsDaily/${date}`).set(
      { ...patch, [`activeUsers.${uid}`]: true, date },
      { merge: true },
    ),
  ]);

  return { ok: true, costMicros };
});

// ---------------------------------------------------------------------------
// Admin read side.
// ---------------------------------------------------------------------------

function requireAdmin(context: functions.https.CallableContext): void {
  if (!context.auth?.uid || context.auth?.token?.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }
}

function dateKeyDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return todayKey(d);
}

export const adminAssistantCosts = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const days = Math.min(Math.max(Number(data?.days) || 30, 1), 180);
    const topLimit = Math.min(Math.max(Number(data?.topLimit) || 20, 1), 100);
    const startKey = dateKeyDaysAgo(days - 1);

    const firestore = db();
    // Per-user rows.
    // NOTE: a collectionGroup query can't range-filter on documentId() with a
    // bare date key — Firestore requires the value to resolve to a full
    // (even-segment) document path for collection-group __name__ queries, so
    // `.where(documentId(), '>=', '20260520')` throws "…odd number of segments"
    // and the whole call 500s (which is why /admin/ai-costs showed nothing).
    // Each assistantUsage doc id IS the yyyymmdd key, so we fetch the group and
    // apply the date window in memory below (one doc per active user per day —
    // a small read at this app's scale).
    const userSnap = await firestore.collectionGroup('assistantUsage').get();

    interface PerUser {
      uid: string;
      turns: number;
      chatCalls: number;
      inputTokens: number;
      outputTokens: number;
      thoughtsTokens: number;
      cachedTokens: number;
      voiceInputAudioTokens: number;
      voiceOutputAudioTokens: number;
      voiceSessions: number;
      costMicros: number;
    }
    const perUser = new Map<string, PerUser>();
    const perDay = new Map<string, { date: string; turns: number; costMicros: number; activeUsers: Set<string> }>();

    for (const doc of userSnap.docs) {
      const dateKey: string = doc.id;
      if (dateKey < startKey) continue; // in-memory date-window filter
      const uid = doc.ref.parent.parent?.id;
      if (!uid) continue;
      const d = doc.data() as any;
      const cost = Number(d.costMicros) || 0;
      const turns = Number(d.turns) || 0;

      const existing = perUser.get(uid) || {
        uid,
        turns: 0,
        chatCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        thoughtsTokens: 0,
        cachedTokens: 0,
        voiceInputAudioTokens: 0,
        voiceOutputAudioTokens: 0,
        voiceSessions: 0,
        costMicros: 0,
      };
      existing.turns += turns;
      existing.chatCalls += Number(d.chatCalls) || 0;
      existing.inputTokens += Number(d.inputTokens) || 0;
      existing.outputTokens += Number(d.outputTokens) || 0;
      existing.thoughtsTokens += Number(d.thoughtsTokens) || 0;
      existing.cachedTokens += Number(d.cachedTokens) || 0;
      existing.voiceInputAudioTokens += Number(d.voiceInputAudioTokens) || 0;
      existing.voiceOutputAudioTokens += Number(d.voiceOutputAudioTokens) || 0;
      existing.voiceSessions += Number(d.voiceSessions) || 0;
      existing.costMicros += cost;
      perUser.set(uid, existing);

      const day = perDay.get(dateKey) || { date: dateKey, turns: 0, costMicros: 0, activeUsers: new Set<string>() };
      day.turns += turns;
      day.costMicros += cost;
      day.activeUsers.add(uid);
      perDay.set(dateKey, day);
    }

    // Resolve top spenders' display info.
    const top = [...perUser.values()]
      .sort((a, b) => b.costMicros - a.costMicros)
      .slice(0, topLimit);
    const uids = top.map((u) => u.uid);
    const authMap = new Map<string, admin.auth.UserRecord>();
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100);
      if (!chunk.length) continue;
      try {
        const res = await admin.auth().getUsers(chunk.map((uid) => ({ uid })));
        for (const u of res.users) authMap.set(u.uid, u);
      } catch {
        // ignore — auth lookup is cosmetic.
      }
    }
    const businessMap = new Map<string, any>();
    await Promise.all(
      uids.map(async (uid) => {
        const b = await firestore.doc(`users/${uid}/settings/business`).get().catch(() => null);
        businessMap.set(uid, b?.data() || {});
      }),
    );

    const totals = [...perUser.values()].reduce(
      (acc, u) => {
        acc.turns += u.turns;
        acc.chatCalls += u.chatCalls;
        acc.inputTokens += u.inputTokens;
        acc.outputTokens += u.outputTokens;
        acc.thoughtsTokens += u.thoughtsTokens;
        acc.cachedTokens += u.cachedTokens;
        acc.voiceInputAudioTokens += u.voiceInputAudioTokens;
        acc.voiceOutputAudioTokens += u.voiceOutputAudioTokens;
        acc.voiceSessions += u.voiceSessions;
        acc.costMicros += u.costMicros;
        return acc;
      },
      {
        turns: 0,
        chatCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        thoughtsTokens: 0,
        cachedTokens: 0,
        voiceInputAudioTokens: 0,
        voiceOutputAudioTokens: 0,
        voiceSessions: 0,
        costMicros: 0,
        activeUsers: perUser.size,
      },
    );

    const series = [...perDay.values()]
      .map((d) => ({
        date: d.date,
        turns: d.turns,
        costMicros: d.costMicros,
        activeUsers: d.activeUsers.size,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      windowDays: days,
      startKey,
      endKey: todayKey(),
      totals,
      series,
      top: top.map((u) => ({
        ...u,
        userEmail: authMap.get(u.uid)?.email || null,
        userBusinessName:
          (businessMap.get(u.uid) || {}).businessName ||
          authMap.get(u.uid)?.displayName ||
          null,
      })),
      pricing: PRICING,
    };
  });

// ---------------------------------------------------------------------------
// Voice (ElevenLabs Agents) — settle the budget hold and record the spend.
//
// A sibling of reportAssistantLiveUsage, not an overload of it. That one is
// called by every shipped build and its payload contract has to survive the
// whole rollback window; burying a budget settlement — which is
// correctness-critical, not just a dashboard number — behind a discriminator
// inside it is how billing quietly breaks.
//
// Without this, assistantToken's 120s hold is parked at mint and never given
// back. On the free tier that is 300s a day: two sessions and the tradie is
// locked out until midnight UTC regardless of how briefly they actually spoke.
// ---------------------------------------------------------------------------

interface VoiceUsagePayload {
  model?: string;
  conversationId?: string;
  durationSeconds?: number;
  holdSeconds?: number;
  endReason?: string;
}

export const reportAssistantVoiceUsage = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');

  const payload: VoiceUsagePayload = data || {};
  const conversationId = String(payload.conversationId || '').trim();
  const model = String(payload.model || 'elevenlabs/claude-sonnet-5');
  const date = todayKey();
  const usageRef = db().doc(`users/${uid}/assistantUsage/${date}`);

  // The session doc, written at mint, carries the plan and the hold that was
  // actually parked — the client is not trusted for either. It also makes this
  // idempotent: the client report and the post-call webhook both land here.
  const sessionRef = conversationId ? db().doc(`voiceSessions/${conversationId}`) : null;

  const settled = await db().runTransaction(async (tx) => {
    const [sessionSnap, usageSnap] = await Promise.all([
      sessionRef ? tx.get(sessionRef) : Promise.resolve(null),
      tx.get(usageRef),
    ]);
    const session = sessionSnap?.data();

    // Someone already settled this conversation. Applying a second time would
    // double-charge both the budget and the dashboard.
    if (session?.settledAt) {
      return { alreadySettled: true, seconds: session.settledSeconds || 0, costMicros: 0 };
    }
    // A session doc that isn't this user's is not this user's to settle.
    if (session && session.uid !== uid) {
      return { alreadySettled: true, seconds: 0, costMicros: 0 };
    }

    const plan: Plan = (session?.plan as Plan) || 'free';
    const ceiling = MAX_SESSION_SECONDS[plan];
    // Clamp before anything lands. This single line is what stops a
    // misbehaving client inflating the day's usage past what the agent's own
    // max_duration_seconds would ever have permitted.
    const actualSeconds = Math.min(
      Math.max(0, Math.round(Number(payload.durationSeconds) || 0)),
      ceiling,
    );
    const holdSeconds = Number(session?.heldSeconds ?? payload.holdSeconds ?? 0);

    const update = settleVoiceSecondsUpdate(usageSnap.data(), { plan, holdSeconds, actualSeconds });
    const costMicros = platformCostMicros(model, actualSeconds);
    const inc = admin.firestore.FieldValue.increment;

    const patch: Record<string, unknown> = {
      voiceSessions: inc(1),
      voiceDurationSeconds: inc(actualSeconds),
      costMicros: inc(costMicros),
      [`models.${sanitiseKey(model)}.voiceCostMicros`]: inc(costMicros),
      [`models.${sanitiseKey(model)}.voiceSessions`]: inc(1),
      [`models.${sanitiseKey(model)}.voiceDurationSeconds`]: inc(actualSeconds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // voiceSeconds is a settled value, not an increment — it has to ride the
    // same transaction as the read it was computed from.
    if (update) patch.voiceSeconds = update.voiceSeconds;

    tx.set(usageRef, patch, { merge: true });
    tx.set(
      db().doc(`assistantCostsDaily/${date}`),
      {
        voiceSessions: inc(1),
        voiceDurationSeconds: inc(actualSeconds),
        costMicros: inc(costMicros),
        [`models.${sanitiseKey(model)}.voiceCostMicros`]: inc(costMicros),
        [`activeUsers.${uid}`]: true,
        date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (sessionRef) {
      tx.set(sessionRef, {
        settledAt: admin.firestore.FieldValue.serverTimestamp(),
        settledBy: 'client',
        settledSeconds: actualSeconds,
        endReason: String(payload.endReason || 'unknown'),
        costMicros,
      }, { merge: true });
    }
    return { alreadySettled: false, seconds: actualSeconds, costMicros };
  });

  return { ok: true, ...settled };
});
