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

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

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
  /** USD per 1M input audio tokens. Only set for Live audio models. */
  inputAudioPerM?: number;
  /** USD per 1M output audio tokens. Only set for Live audio models. */
  outputAudioPerM?: number;
}

export const PRICING: Record<string, ModelPricing> = {
  // Text chat model used by assistantChat.
  'gemini-3-flash-preview': {
    inputPerM: 0.30,
    outputPerM: 2.50,
    cachedInputPerM: 0.075,
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
}

export function costMicrosForChat(model: string, u: GeminiUsageMetadata): number {
  const p = pricingFor(model);
  const promptTotal = u.promptTokenCount || 0;
  const cached = u.cachedContentTokenCount || 0;
  const billedInput = Math.max(0, promptTotal - cached);
  const output = u.candidatesTokenCount || 0;
  const thoughts = u.thoughtsTokenCount || 0;
  // Gemini bills thoughts at the output rate (they're model-generated tokens).
  const usd =
    (billedInput * p.inputPerM) +
    (cached * p.cachedInputPerM) +
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

function costMicrosForLive(model: string, u: LiveUsagePayload): number {
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
    const userSnap = await firestore
      .collectionGroup('assistantUsage')
      .where(admin.firestore.FieldPath.documentId(), '>=', startKey)
      .get();

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
      const uid = doc.ref.parent.parent?.id;
      if (!uid) continue;
      const d = doc.data() as any;
      const dateKey: string = doc.id;
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
