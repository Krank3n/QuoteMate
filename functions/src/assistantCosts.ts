// Mate assistant — token-usage + cost recorder and admin query surface.
//
// Three write paths feed `users/{uid}/assistantUsage/{yyyymmdd}`:
//   1. `recordChatUsage` — called from assistantChat after every Gemini
//      generateContent reply. Reads usageMetadata verbatim from Gemini and
//      converts it to USD micros using PRICING below.
//   2. `reportAssistantLiveUsage` (callable) — the RN client posts the Live
//      WebSocket's per-turn usageMetadata frames here. The server can't see
//      them directly because the WS runs device→Gemini with an ephemeral
//      token, so this is the only way to know what voice actually cost.
//   3. `reportAssistantVoiceUsage` (callable) — the same job for the two
//      non-Gemini voice providers, which additionally settle the budget hold
//      their mint parked. ElevenLabs bills connected minutes; OpenAI Realtime
//      bills tokens and sends them in the same payload.
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

/**
 * The OpenAI voice session's SECOND bill: input audio transcription runs on
 * its own model and is charged apart from the Realtime one.
 *
 * Declared HERE, beside its PRICING row, rather than imported from
 * assistantVoiceToken — that module exists to keep vendor code (it pulls in
 * node-fetch) off the path assistantChat takes, and assistantChat imports this
 * file for recordChatUsage. A string constant is not worth putting the mint
 * module in text chat's cold start.
 *
 * Must be kept in step with OA_TRANSCRIBE_MODEL in openAiVoiceSession.ts,
 * whose own comment notes the model has to move before Feb 2027.
 */
export const OA_TRANSCRIBE_MODEL_LABEL = 'openai/gpt-4o-transcribe';

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
  /** USD per 1M CACHED input audio tokens. Only set where a platform prices
   *  cached audio apart from cached text (OpenAI Realtime discounts audio by
   *  80x on a cache hit); unset means cached audio bills at cachedInputPerM,
   *  which is what every pre-existing row does. */
  cachedInputAudioPerM?: number;
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
  /**
   * USD charged once per SESSION regardless of length.
   *
   * Measured, not estimated: a 64-second call cost $0.147, and $0.056 of that
   * was a single Anthropic cache WRITE — 91% of the LLM charge — re-paying the
   * 20.5k-token system prompt and tool schemas because the cache had expired
   * since the last call. It does not scale with duration, so short sessions
   * are the expensive ones: ~$0.20/min effective at 30 seconds against
   * ~$0.09/min at ten minutes.
   *
   * Modelling it as per-minute, which is what the first cut did, under-reports
   * every short session on /admin/ai-costs.
   */
  perSessionUsd?: number;
}

export const PRICING: Record<string, ModelPricing> = {
  // Superseded by gemini-3.7-flash below. Kept because historical daily docs
  // still carry models.gemini-3-flash-preview.* and pricingFor() falls back
  // to this key for any model we haven't priced.
  'gemini-3-flash-preview': {
    inputPerM: 0.30,
    outputPerM: 2.50,
    cachedInputPerM: 0.075,
  },
  // Gemini revert path for assistantChat (see CHAT_PROVIDER) since Aug 2026.
  // Priced at the POST-intro rate for the same reason as Sonnet 5 below: the
  // $0.75/$3.75 introductory window runs to 2026-12-31, and recording the
  // intro price would under-count every turn from January.
  // cachedInputPerM is derived at the same 0.25x of input the other Gemini
  // rows use, not separately quoted — correct it if you check the rate card.
  'gemini-3.7-flash': {
    inputPerM: 1.50,
    outputPerM: 7.50,
    cachedInputPerM: 0.375,
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
    // Measured on a real 64s session (conv_1901m10c…): the per-session cache
    // write dominates the LLM bill. Trimming the prompt or the tool schemas
    // would cut this directly — it is 20.5k tokens of fixed overhead per call.
    perSessionUsd: 0.062,
  },
  // Voice via OpenAI Realtime — the model openAiVoiceSession opens the socket
  // with (assistantVoiceToken.OA_REALTIME_MODEL), under the compound label
  // OA_VOICE_MODEL_LABEL. Compound for the same reason as the ElevenLabs row:
  // spend on this provider has to stay separable on the daily doc.
  //
  // Rates per 1M tokens, confirmed 11 Sep 2026 against
  // https://developers.openai.com/api/docs/models/gpt-realtime-2.1
  //   text  $4.00 in / $0.40 cached in / $24.00 out
  //   audio $32.00 in / $0.40 cached in / $64.00 out
  //
  // Audio is the whole bill in practice. At OpenAI's own conversion — user
  // audio ~1 token per 100ms, model audio ~1 per 50ms — a minute of the tradie
  // talking is ~$0.019 and a minute of Mate answering ~$0.077, which is why
  // this row is not optional if the assistant figure is meant to be true.
  //
  // NOTE there is no perMinuteUsd here on purpose: this platform bills tokens,
  // not connected minutes, so platformCostMicros returns 0 for it and the cost
  // comes entirely from costMicrosForOpenAiRealtime.
  'openai/gpt-realtime-2.1': {
    inputPerM: 4.00,
    outputPerM: 24.00,
    cachedInputPerM: 0.40,
    inputAudioPerM: 32.00,
    outputAudioPerM: 64.00,
    cachedInputAudioPerM: 0.40,
  },
  // The OpenAI voice session's second bill: input audio transcription runs on
  // its own model and is charged apart from the Realtime model above. Its
  // usage never appears in response.usage — it arrives on
  // conversation.item.input_audio_transcription.completed, as a DURATION.
  //
  // So this row is priced per minute, not per token. $0.006/min is OpenAI's
  // published duration-equivalent of the token rates below ($2.50/1M audio in,
  // $10.00/1M text out —
  // https://developers.openai.com/api/docs/models/gpt-4o-transcribe), and is
  // the same figure openAiVoiceSession's model note already quotes when it
  // compares this model against gpt-live-transcribe at $0.017/min.
  //
  // The token rates are recorded for reconciliation only; nothing multiplies
  // them, because the client reports seconds.
  'openai/gpt-4o-transcribe': {
    inputPerM: 2.50,
    outputPerM: 10.00,
    cachedInputPerM: 2.50,
    perMinuteUsd: 0.006,
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
  const perMinute = (seconds / 60) * rate;
  // The fixed per-session component (the prompt cache write) is charged once,
  // and only for a session that actually happened.
  const perSession = seconds > 0 ? (p.perSessionUsd ?? 0) : 0;
  return Math.round((perMinute + perSession) * 1_000_000);
}

// ---------------------------------------------------------------------------
// OpenAI Realtime token cost
// ---------------------------------------------------------------------------

/**
 * What an OpenAI Realtime session reported using, summed over the session by
 * the client (accumulateOpenAiUsage in openAiVoiceSession.ts). The server never
 * sees these frames: the socket runs device→OpenAI on an ephemeral client
 * secret, exactly as the Gemini Live one does.
 *
 * THE FIELDS ARE TOTALS, CACHE INCLUDED. That is how OpenAI reports them —
 * response.usage.input_token_details.text_tokens counts the cached part too,
 * and cached_tokens_details says how much of it was cached — and it matches
 * costMicrosForChat and costMicrosForLive, which both subtract the cached
 * portion here rather than trusting the caller to have done it. Sending
 * pre-subtracted totals instead would bill cached audio at the fresh rate: an
 * 80x error on the single largest line.
 */
export interface OpenAiRealtimeUsagePayload {
  inputTextTokens?: number;
  inputAudioTokens?: number;
  cachedInputTextTokens?: number;
  cachedInputAudioTokens?: number;
  outputTextTokens?: number;
  outputAudioTokens?: number;
}

/**
 * USD micros for one OpenAI Realtime session's tokens.
 *
 * Same identity every other cost function in this file leans on:
 * tokens * pricePerM === micros.
 */
export function costMicrosForOpenAiRealtime(
  model: string,
  u: OpenAiRealtimeUsagePayload,
): number {
  const p = pricingFor(model);
  const inputText = Math.max(0, u.inputTextTokens || 0);
  const inputAudio = Math.max(0, u.inputAudioTokens || 0);
  // Clamped to the modality's own total: a cached count larger than the input
  // it came from would otherwise credit tokens that were never billed.
  const cachedText = Math.min(Math.max(0, u.cachedInputTextTokens || 0), inputText);
  const cachedAudio = Math.min(Math.max(0, u.cachedInputAudioTokens || 0), inputAudio);
  const usd =
    ((inputText - cachedText) * p.inputPerM) +
    (cachedText * p.cachedInputPerM) +
    ((inputAudio - cachedAudio) * (p.inputAudioPerM ?? p.inputPerM)) +
    (cachedAudio * (p.cachedInputAudioPerM ?? p.cachedInputPerM)) +
    (Math.max(0, u.outputTextTokens || 0) * p.outputPerM) +
    (Math.max(0, u.outputAudioTokens || 0) * (p.outputAudioPerM ?? p.outputPerM));
  return Math.round(usd);
}

/**
 * Whether this model's voice spend is measured in TOKENS rather than connected
 * minutes — i.e. whether a `usage` payload means anything for it at all.
 *
 * Load-bearing, not a convenience. The ElevenLabs row carries full Sonnet
 * token rates for reconciliation against their charging breakdown, and nothing
 * else stops those rates being multiplied by numbers a client supplied. A
 * per-minute session that also accepted a token payload would bill twice, at
 * up to 600x, under a model key whose cost is supposed to be duration.
 */
export function billsTokens(model: string): boolean {
  return !pricingFor(model).perMinuteUsd;
}

/** One model's share of a voice session's cost. */
export interface VoiceCostLine {
  /** Raw PRICING key — sanitiseKey is applied at the Firestore field path. */
  model: string;
  costMicros: number;
}

/**
 * Everything one voice session bills, split by model, session model first.
 *
 * A session is not necessarily one model. ElevenLabs is a single per-minute
 * line. An OpenAI session is two: the Realtime model's tokens, plus the
 * separately-charged transcription model that turns the tradie's audio into
 * the text the reply gate reads. Keeping them as separate lines is what lets
 * /admin/ai-costs say which of the two is costing money, the same argument the
 * compound model keys exist for.
 */
export function voiceSessionCostLines(args: {
  model: string;
  seconds: number;
  usage?: OpenAiRealtimeUsagePayload;
  transcriptionModel?: string;
  transcriptionSeconds?: number;
}): VoiceCostLine[] {
  // A session of no length is one that never happened, and nothing it claims
  // to have used can be true. Held to for the TOKEN side as well as the
  // per-minute side, which platformCostMicros has always done: without it, a
  // zero-second report is an unbounded write onto the day's cost that costs
  // its caller no talk-time budget at all, because the duration clamp that
  // bounds every other number here no longer touches the total.
  //
  // The client only ever sends usage once a turn has completed, which cannot
  // happen inside the half-second that rounds to zero, so nothing real is lost.
  if (args.seconds <= 0) return [{ model: args.model, costMicros: 0 }];

  // Each shape's cost comes from its own measure and never both: tokens for a
  // platform that bills tokens, connected minutes for one that bills minutes.
  // See billsTokens — crossing them is a 600x error a client could ask for.
  const primary = billsTokens(args.model)
    ? (args.usage ? costMicrosForOpenAiRealtime(args.model, args.usage) : 0)
    : platformCostMicros(args.model, args.seconds);
  const lines: VoiceCostLine[] = [{ model: args.model, costMicros: primary }];
  const transcriptionSeconds = Math.max(0, args.transcriptionSeconds || 0);
  if (args.transcriptionModel && transcriptionSeconds > 0) {
    lines.push({
      model: args.transcriptionModel,
      costMicros: platformCostMicros(args.transcriptionModel, transcriptionSeconds),
    });
  }
  return lines;
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
// Voice (ElevenLabs Agents and OpenAI Realtime) — settle the budget hold and
// record the spend.
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
//
// BOTH non-Gemini providers land here, because both park that same hold at
// mint and both are invisible to the server once the socket is open. What
// differs is only what they cost: ElevenLabs bills connected minutes, so
// duration IS the bill, while OpenAI bills tokens, so the client also sends
// what the session reported using. The alternative — a third onCall for the
// OpenAI shape — would have meant two settlement paths against one hold, which
// is the one thing this function exists to keep single.
// ---------------------------------------------------------------------------

interface VoiceUsagePayload {
  model?: string;
  conversationId?: string;
  durationSeconds?: number;
  holdSeconds?: number;
  endReason?: string;
  /** OpenAI Realtime only — token totals for the session. Absent means the
   *  provider bills by the minute and duration already says the cost. */
  usage?: OpenAiRealtimeUsagePayload;
  /** OpenAI Realtime only — seconds of audio the transcription model billed,
   *  from the transcription events' own usage blocks. */
  transcriptionSeconds?: number;
}

export const reportAssistantVoiceUsage = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');

  const payload: VoiceUsagePayload = data || {};
  const conversationId = String(payload.conversationId || '').trim();
  const requestedModel = String(payload.model || 'elevenlabs/claude-sonnet-5');
  // Same idea as reportAssistantLiveUsage's clamp: a misbehaving client must
  // not be able to poison the cost dashboard. The two sides get different
  // ceilings because Realtime bills them differently. OUTPUT is produced once,
  // so 5M output tokens is already hours of speech. INPUT is re-billed on
  // every response — each turn charges the whole conversation so far — so a
  // long, chatty Pro session legitimately sums to several million input
  // tokens (a 45-minute session at a turn every ~10 s passes 5M, mostly
  // cached). Clipping that would under-count the exact sessions that cost
  // the most, so input gets 20M. Above that it is a bug, not a conversation.
  const INPUT_CAP = 20_000_000;
  const OUTPUT_CAP = 5_000_000;
  const clampTo = (cap: number) => (n: unknown) =>
    Math.max(0, Math.min(cap, Math.floor(Number(n) || 0)));
  const clampIn = clampTo(INPUT_CAP);
  const clampOut = clampTo(OUTPUT_CAP);
  const reported = payload.usage;
  const usage: OpenAiRealtimeUsagePayload | undefined = reported
    ? {
      inputTextTokens: clampIn(reported.inputTextTokens),
      inputAudioTokens: clampIn(reported.inputAudioTokens),
      cachedInputTextTokens: clampIn(reported.cachedInputTextTokens),
      cachedInputAudioTokens: clampIn(reported.cachedInputAudioTokens),
      outputTextTokens: clampOut(reported.outputTextTokens),
      outputAudioTokens: clampOut(reported.outputAudioTokens),
    }
    : undefined;
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
    // The session doc records which model was actually minted, so it beats the
    // client's word on what to price — the device could otherwise name a
    // cheaper row than the one it was served.
    const model = String(session?.model || requestedModel);
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
    const lines = voiceSessionCostLines({
      model,
      seconds: actualSeconds,
      usage,
      // Server-decided, never taken from the client — see
      // OA_TRANSCRIBE_MODEL_LABEL. Transcribed audio cannot exceed the time
      // the socket was connected, so the settled duration is its ceiling.
      transcriptionModel: model.startsWith('openai/') ? OA_TRANSCRIBE_MODEL_LABEL : undefined,
      transcriptionSeconds: Math.min(
        Math.max(0, Math.round(Number(payload.transcriptionSeconds) || 0)),
        actualSeconds,
      ),
    });
    const costMicros = lines.reduce((sum, line) => sum + line.costMicros, 0);
    const inc = admin.firestore.FieldValue.increment;

    // A token-billed report of zero seconds is a settle-only one: the OpenAI
    // transport is condemned before a word is said often enough to have its
    // own error class, and each of those opens still parked a hold. Counting
    // them would put the failed halves of "OpenAI died, Gemini answered" in
    // the session tally twice over.
    //
    // A per-minute provider cannot say the same thing with a zero. Its client
    // only ever reports after connect, so zero there is a real conversation
    // that rounded down — and the ElevenLabs webhook only back-fills the count
    // for a session that never reported at all, so skipping it here would lose
    // that conversation from the tally permanently.
    const tokenBilled = billsTokens(model);
    const sessionDelta = tokenBilled && actualSeconds === 0 ? 0 : 1;

    const patch: Record<string, unknown> = {
      voiceSessions: inc(sessionDelta),
      voiceDurationSeconds: inc(actualSeconds),
      costMicros: inc(costMicros),
      [`models.${sanitiseKey(model)}.voiceSessions`]: inc(sessionDelta),
      [`models.${sanitiseKey(model)}.voiceDurationSeconds`]: inc(actualSeconds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const globalPatch: Record<string, unknown> = {
      voiceSessions: inc(sessionDelta),
      voiceDurationSeconds: inc(actualSeconds),
      costMicros: inc(costMicros),
      [`activeUsers.${uid}`]: true,
      date,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // One field per model the session billed. For ElevenLabs that is the one
    // line it has always been; an OpenAI session also carries its transcriber.
    for (const line of lines) {
      const key = `models.${sanitiseKey(line.model)}.voiceCostMicros`;
      patch[key] = inc(line.costMicros);
      globalPatch[key] = inc(line.costMicros);
    }
    // Token counters, under the SAME field names reportAssistantLiveUsage
    // writes — so the per-modality totals on the daily doc, and the columns
    // adminAssistantCosts already sums out of them, cover every voice provider
    // that bills tokens rather than needing a second set of fields.
    //
    // Gated exactly as the cost above is. A per-minute provider reports no
    // tokens, so a payload claiming some is a client that should be ignored,
    // not believed; and a session of zero seconds used none.
    if (usage && tokenBilled && actualSeconds > 0) {
      const voiceTokens: Record<string, unknown> = {
        voiceInputTextTokens: inc(usage.inputTextTokens || 0),
        voiceOutputTextTokens: inc(usage.outputTextTokens || 0),
        voiceInputAudioTokens: inc(usage.inputAudioTokens || 0),
        voiceOutputAudioTokens: inc(usage.outputAudioTokens || 0),
        voiceCachedTokens: inc(
          (usage.cachedInputTextTokens || 0) + (usage.cachedInputAudioTokens || 0),
        ),
      };
      Object.assign(patch, voiceTokens);
      Object.assign(globalPatch, voiceTokens);
    }
    // voiceSeconds is a settled value, not an increment — it has to ride the
    // same transaction as the read it was computed from.
    if (update) patch.voiceSeconds = update.voiceSeconds;

    tx.set(usageRef, patch, { merge: true });
    tx.set(db().doc(`assistantCostsDaily/${date}`), globalPatch, { merge: true });
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
