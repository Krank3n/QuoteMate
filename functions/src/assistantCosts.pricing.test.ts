// Pins the chat cost arithmetic across the two providers' billing shapes —
// in particular that Claude cache WRITES bill at their premium rate and cache
// READS at the discounted one, instead of everything flattening to inputPerM.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firestore, for the settle-and-record path at the bottom of this file. The
// pure pricing functions above it never touch it.
const store = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{ path: string; patch: Record<string, any> }>,
}));
vi.mock('firebase-admin', () => {
  const snap = (path: string) => ({
    exists: store.docs.has(path),
    data: () => store.docs.get(path),
  });
  const db = {
    doc: (path: string) => ({ path, get: async () => snap(path) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async (ref: { path: string }) => snap(ref.path),
      set: (ref: { path: string }, patch: Record<string, unknown>) => {
        store.writes.push({ path: ref.path, patch });
      },
    }),
  };
  return {
    firestore: Object.assign(() => db, {
      FieldValue: {
        increment: (n: number) => ({ __inc: n }),
        serverTimestamp: () => ({ __serverTimestamp: true }),
      },
    }),
  };
});

import {
  costMicrosForChat,
  costMicrosForLive,
  costMicrosForOpenAiRealtime,
  voiceSessionCostLines,
  platformCostMicros,
  reportAssistantVoiceUsage,
  todayKey,
  PRICING,
} from './assistantCosts';

describe('costMicrosForChat', () => {
  it('bills a claude-sonnet-5 turn with cache reads and writes at their own rates', () => {
    // 1,000 plain input + 8,000 cache-read + 500 cache-write + 300 output.
    const micros = costMicrosForChat('claude-sonnet-5', {
      promptTokenCount: 9500,
      candidatesTokenCount: 300,
      cachedContentTokenCount: 8000,
      cacheWriteTokenCount: 500,
    });
    const expected =
      1000 * 3.0 + // plain input
      8000 * 0.3 + // cache read
      500 * 3.75 + // cache write premium
      300 * 15.0; // output
    expect(micros).toBe(Math.round(expected));
  });

  it('keeps the legacy gemini arithmetic unchanged (no cacheWrite field)', () => {
    const micros = costMicrosForChat('gemini-3-flash-preview', {
      promptTokenCount: 10000,
      candidatesTokenCount: 400,
      cachedContentTokenCount: 6000,
      thoughtsTokenCount: 100,
    });
    const expected = 4000 * 0.3 + 6000 * 0.075 + (400 + 100) * 2.5;
    expect(micros).toBe(Math.round(expected));
  });

  it('has a pricing row for the live chat model', () => {
    expect(PRICING['claude-sonnet-5']).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Per-minute voice pricing (ElevenLabs Agents)
// ---------------------------------------------------------------------------

describe('platformCostMicros', () => {
  it('charges the per-session prompt-cache write once, not per minute', () => {
    // Measured on a real 64s call: $0.056 of a $0.062 LLM bill was a single
    // Anthropic cache write re-paying the 20.5k-token prompt. It does not
    // scale with duration, so a 30s call and a 10min call pay it identically.
    const short = platformCostMicros('elevenlabs/claude-sonnet-5', 30);
    const long = platformCostMicros('elevenlabs/claude-sonnet-5', 600);
    expect(short - 40_000).toBe(62_000);          // 30s of platform + the fixed cost
    expect(long - 800_000).toBe(62_000);          // 10min of platform + the SAME fixed cost
  });

  it('makes short sessions dearer per minute, which is the real shape', () => {
    const perMin = (secs: number) =>
      platformCostMicros('elevenlabs/claude-sonnet-5', secs) / (secs / 60);
    expect(perMin(30)).toBeGreaterThan(perMin(600));
  });

  it('charges nothing at all for a session that never happened', () => {
    // A mint that failed before connect must not be billed a cache write for
    // a prompt that was never sent.
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', 0)).toBe(0);
  });

  it('costs 6 minutes of platform time at $0.08/min as 480,000 micros', () => {
    // THE unit guard. Every other term in assistantCosts relies on
    // tokens * pricePerM === micros; a per-minute rate is plain USD and needs
    // an explicit * 1e6. A factor-of-a-million slip here looks entirely
    // plausible on the dashboard, which is why it is pinned to a literal.
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', 360) - 62_000).toBe(480_000);
  });

  it('scales linearly with duration', () => {
    const FIXED = 62_000;
    const one = platformCostMicros('elevenlabs/claude-sonnet-5', 60) - FIXED;
    expect(one).toBe(80_000);
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', 120) - FIXED).toBe(one * 2);
  });

  it('charges part-minutes proportionally rather than rounding up', () => {
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', 30) - 62_000).toBe(40_000);
  });

  it('doubles at the burst rate when over the concurrency limit', () => {
    const FIXED = 62_000;
    const standard = platformCostMicros('elevenlabs/claude-sonnet-5', 360) - FIXED;
    const burst = platformCostMicros('elevenlabs/claude-sonnet-5', 360, { burst: true }) - FIXED;
    expect(burst).toBe(standard * 2);
  });

  it('costs nothing for a zero-length or negative duration', () => {
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', 0)).toBe(0);
    expect(platformCostMicros('elevenlabs/claude-sonnet-5', -100)).toBe(0);
  });

  it('costs nothing for a token-billed model, so the Gemini rows are untouched', () => {
    expect(platformCostMicros('gemini-3.1-flash-live-preview', 600)).toBe(0);
    expect(platformCostMicros('claude-sonnet-5', 600)).toBe(0);
  });
});

describe('ElevenLabs pricing row', () => {
  it('exists and carries a per-minute rate', () => {
    expect(PRICING['elevenlabs/claude-sonnet-5'].perMinuteUsd).toBe(0.08);
  });

  it('uses a compound key so voice spend stays separable from text spend', () => {
    // Both run claude-sonnet-5; fusing the keys would make /admin/ai-costs
    // unable to say whether Mate's cost comes from typing or talking.
    expect(PRICING['elevenlabs/claude-sonnet-5']).not.toBe(PRICING['claude-sonnet-5']);
  });

  it('survives sanitiseKey as a legal Firestore field path segment', () => {
    const key = 'elevenlabs/claude-sonnet-5'.replace(/[.#$/[\]]/g, '_');
    expect(key).toBe('elevenlabs_claude-sonnet-5');
    expect(key).not.toMatch(/[.#$/[\]]/);
  });
});

describe('token-cost regression for the pre-existing rows', () => {
  it('costs a Gemini Live session exactly as it did before the voice swap', () => {
    // Guards the additive change: adding perMinuteUsd must not perturb any
    // existing arithmetic. 1M input audio tokens at $0.50/M = $0.50 = 500k micros.
    expect(costMicrosForLive('gemini-3.1-flash-live-preview', {
      inputAudioTokens: 1_000_000,
    })).toBe(500_000);
  });
});

// ---------------------------------------------------------------------------
// OpenAI Realtime (token-billed voice)
// ---------------------------------------------------------------------------

/**
 * A plausible 90-second session, in the shape the client accumulates from
 * response.done: the modality totals INCLUDE their cached part, because that
 * is how OpenAI reports them.
 *
 *   fresh audio in    6,000 @ $32/M    = 192,000 micros
 *   cached audio in  24,000 @ $0.40/M  =   9,600
 *   fresh text in     3,000 @ $4/M     =  12,000
 *   cached text in    9,000 @ $0.40/M  =   3,600
 *   audio out         2,400 @ $64/M    = 153,600
 *   text out            300 @ $24/M    =   7,200
 *                                        -------
 *                                        378,000 micros  ($0.378)
 */
const OA_SESSION = {
  inputTextTokens: 12_000,
  inputAudioTokens: 30_000,
  cachedInputTextTokens: 9_000,
  cachedInputAudioTokens: 24_000,
  outputTextTokens: 300,
  outputAudioTokens: 2_400,
};
const OA_SESSION_MICROS = 378_000;
const OA_MODEL = 'openai/gpt-realtime-2.1';

describe('costMicrosForOpenAiRealtime', () => {
  it('prices a real session across text, audio, cached and output tokens', () => {
    expect(costMicrosForOpenAiRealtime(OA_MODEL, OA_SESSION)).toBe(OA_SESSION_MICROS);
  });

  it('bills cached audio at the cache rate, not the fresh audio rate', () => {
    // $32/M against $0.40/M is an 80x gap, and cached audio is most of the
    // input on any session past the first turn — flattening the two is the
    // single most expensive mistake available in this file.
    const allFresh = costMicrosForOpenAiRealtime(OA_MODEL, { inputAudioTokens: 24_000 });
    const allCached = costMicrosForOpenAiRealtime(OA_MODEL, {
      inputAudioTokens: 24_000, cachedInputAudioTokens: 24_000,
    });
    expect(allFresh).toBe(768_000);
    expect(allCached).toBe(9_600);
  });

  it('costs nothing for a session that reported no usage', () => {
    // The crash/abort path reports zeroes to hand the budget hold back. It
    // must not manufacture a cost out of an empty payload.
    expect(costMicrosForOpenAiRealtime(OA_MODEL, {})).toBe(0);
    expect(costMicrosForOpenAiRealtime(OA_MODEL, {
      inputTextTokens: 0, inputAudioTokens: 0, outputAudioTokens: 0,
    })).toBe(0);
  });

  it('never credits more cached tokens than the modality actually carried', () => {
    // A client claiming 1M cached audio against 1k of audio input would
    // otherwise book a negative line and pay the tradie to talk.
    const micros = costMicrosForOpenAiRealtime(OA_MODEL, {
      inputAudioTokens: 1_000, cachedInputAudioTokens: 1_000_000,
    });
    expect(micros).toBe(400); // all 1,000 at the cached rate, nothing negative
  });

  it('leaves the unknown-model fallback exactly as it was', () => {
    // pricingFor() falls back to gemini-3-flash-preview for anything unpriced,
    // and adding OpenAI rows must not change that. 1M input tokens @ $0.30/M.
    expect(costMicrosForOpenAiRealtime('some-model-we-never-priced', {
      inputTextTokens: 1_000_000,
    })).toBe(300_000);
    // With no audio rate on that row, audio bills at the text rate — the same
    // ?? fallbacks costMicrosForLive has always used.
    expect(costMicrosForOpenAiRealtime('some-model-we-never-priced', {
      inputAudioTokens: 1_000_000,
    })).toBe(300_000);
  });
});

describe('OpenAI pricing rows', () => {
  it('matches the published Realtime rate card', () => {
    // https://developers.openai.com/api/docs/models/gpt-realtime-2.1
    expect(PRICING[OA_MODEL]).toMatchObject({
      inputPerM: 4.00,
      outputPerM: 24.00,
      cachedInputPerM: 0.40,
      inputAudioPerM: 32.00,
      outputAudioPerM: 64.00,
      cachedInputAudioPerM: 0.40,
    });
  });

  it('prices the transcriber by the minute, since that is how it reports', () => {
    // Transcription usage arrives as a duration on the transcription event,
    // not as tokens inside response.usage.
    expect(PRICING['openai/gpt-4o-transcribe'].perMinuteUsd).toBe(0.006);
    expect(platformCostMicros('openai/gpt-4o-transcribe', 60)).toBe(6_000);
  });

  it('keeps the Realtime model off the per-minute path entirely', () => {
    // It bills tokens. A perMinuteUsd here would double-charge every session.
    expect(PRICING[OA_MODEL].perMinuteUsd).toBeUndefined();
    expect(platformCostMicros(OA_MODEL, 600)).toBe(0);
  });

  it('survives sanitiseKey as a legal Firestore field path segment', () => {
    expect(OA_MODEL.replace(/[.#$/[\]]/g, '_')).toBe('openai_gpt-realtime-2_1');
  });
});

describe('voiceSessionCostLines', () => {
  it('splits an OpenAI session into its Realtime and transcription bills', () => {
    const lines = voiceSessionCostLines({
      model: OA_MODEL,
      seconds: 90,
      usage: OA_SESSION,
      transcriptionModel: 'openai/gpt-4o-transcribe',
      transcriptionSeconds: 45,
    });
    expect(lines).toEqual([
      { model: OA_MODEL, costMicros: OA_SESSION_MICROS },
      { model: 'openai/gpt-4o-transcribe', costMicros: 4_500 }, // 45s @ $0.006/min
    ]);
  });

  it('drops the transcription line when nothing was transcribed', () => {
    const lines = voiceSessionCostLines({
      model: OA_MODEL,
      seconds: 90,
      usage: OA_SESSION,
      transcriptionModel: 'openai/gpt-4o-transcribe',
      transcriptionSeconds: 0,
    });
    expect(lines).toHaveLength(1);
  });

  it('leaves an ElevenLabs session as the single per-minute line it always was', () => {
    const lines = voiceSessionCostLines({ model: 'elevenlabs/claude-sonnet-5', seconds: 360 });
    expect(lines).toEqual([
      {
        model: 'elevenlabs/claude-sonnet-5',
        costMicros: platformCostMicros('elevenlabs/claude-sonnet-5', 360),
      },
    ]);
  });

  it('refuses to bill tokens against a model that charges by the minute', () => {
    // The ElevenLabs row carries full Sonnet token rates for reconciliation
    // against their charging breakdown. Nothing else stops a client's `usage`
    // blob being multiplied by them ON TOP of the per-minute charge: 5M input
    // and 5M output tokens at $3/$15 is $90 added to a $0.14 session, under a
    // model key whose cost is supposed to mean duration.
    const perMinuteOnly = platformCostMicros('elevenlabs/claude-sonnet-5', 60);
    const withTokens = voiceSessionCostLines({
      model: 'elevenlabs/claude-sonnet-5',
      seconds: 60,
      usage: { inputTextTokens: 5_000_000, outputTextTokens: 5_000_000 },
    });
    expect(withTokens).toEqual([
      { model: 'elevenlabs/claude-sonnet-5', costMicros: perMinuteOnly },
    ]);
  });

  it('costs nothing for a zero-second report, however many tokens it claims', () => {
    // The duration clamp is what bounds every other number in this function.
    // A token cost computed without reference to duration escapes it entirely:
    // a settle-only report would write an unbounded figure onto the day's cost
    // while consuming none of the caller's own talk-time budget, which makes
    // it repeatable. A session of no length used nothing.
    const lines = voiceSessionCostLines({
      model: OA_MODEL,
      seconds: 0,
      usage: { inputAudioTokens: 5_000_000, outputAudioTokens: 5_000_000 },
      transcriptionModel: 'openai/gpt-4o-transcribe',
      transcriptionSeconds: 600,
    });
    expect(lines).toEqual([{ model: OA_MODEL, costMicros: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// reportAssistantVoiceUsage — the daily docs it actually writes
// ---------------------------------------------------------------------------

const DATE = todayKey();
const USAGE_PATH = `users/u1/assistantUsage/${DATE}`;
const DAILY_PATH = `assistantCostsDaily/${DATE}`;

/** The increment a patch parks on a field path, or undefined if it wrote none. */
const incOf = (patch: Record<string, any>, field: string): number | undefined =>
  patch?.[field]?.__inc;

const patchAt = (path: string) =>
  store.writes.find((w) => w.path === path)?.patch as Record<string, any>;

const runVoiceReport = (payload: Record<string, unknown>) =>
  (reportAssistantVoiceUsage as any).run(payload, { auth: { uid: 'u1' } });

beforeEach(() => {
  store.docs.clear();
  store.writes.length = 0;
});

describe('reportAssistantVoiceUsage: OpenAI daily-doc aggregation', () => {
  beforeEach(() => {
    store.docs.set('voiceSessions/oa_1', {
      uid: 'u1', plan: 'pro', model: OA_MODEL, heldSeconds: 120,
    });
    store.docs.set(USAGE_PATH, { voiceSeconds: 120 });
  });

  it('books both models under models.<model>.voiceCostMicros on both daily docs', async () => {
    await runVoiceReport({
      model: OA_MODEL,
      conversationId: 'oa_1',
      durationSeconds: 90,
      holdSeconds: 120,
      endReason: 'ended',
      usage: OA_SESSION,
      transcriptionSeconds: 45,
    });

    for (const path of [USAGE_PATH, DAILY_PATH]) {
      const patch = patchAt(path);
      expect(incOf(patch, 'models.openai_gpt-realtime-2_1.voiceCostMicros'))
        .toBe(OA_SESSION_MICROS);
      expect(incOf(patch, 'models.openai_gpt-4o-transcribe.voiceCostMicros')).toBe(4_500);
      // The dashboard's headline number is the sum of the lines, not one of them.
      expect(incOf(patch, 'costMicros')).toBe(OA_SESSION_MICROS + 4_500);
    }
  });

  it('records the per-modality token counters the admin page already sums', async () => {
    await runVoiceReport({
      model: OA_MODEL, conversationId: 'oa_1', durationSeconds: 90,
      usage: OA_SESSION, transcriptionSeconds: 45,
    });
    const patch = patchAt(USAGE_PATH);
    expect(incOf(patch, 'voiceInputAudioTokens')).toBe(30_000);
    expect(incOf(patch, 'voiceOutputAudioTokens')).toBe(2_400);
    expect(incOf(patch, 'voiceInputTextTokens')).toBe(12_000);
    expect(incOf(patch, 'voiceOutputTextTokens')).toBe(300);
    expect(incOf(patch, 'voiceCachedTokens')).toBe(33_000); // text + audio cache hits
    expect(incOf(patch, 'voiceDurationSeconds')).toBe(90);
    expect(incOf(patch, 'voiceSessions')).toBe(1);
  });

  it('settles the 120s hold down to what was actually spoken', async () => {
    // The whole reason this call exists for OpenAI: before it, the hold sat
    // there until midnight UTC because nothing ever reported.
    await runVoiceReport({
      model: OA_MODEL, conversationId: 'oa_1', durationSeconds: 90,
      usage: OA_SESSION, transcriptionSeconds: 45,
    });
    expect(patchAt(USAGE_PATH).voiceSeconds).toBe(90);
  });

  it('hands the whole hold back when the transport died before a word', async () => {
    // openAiVoiceSession reports zeroes on the transport-unavailable path,
    // which is the common one — it is how the Gemini fallback gets reached.
    await runVoiceReport({
      model: OA_MODEL, conversationId: 'oa_1', durationSeconds: 0,
      endReason: 'transport-unavailable',
      usage: { inputTextTokens: 0, inputAudioTokens: 0, outputAudioTokens: 0 },
      transcriptionSeconds: 0,
    });
    const patch = patchAt(USAGE_PATH);
    expect(patch.voiceSeconds).toBe(0);
    expect(incOf(patch, 'costMicros')).toBe(0);
    // ...and it is not a conversation. The tradie is about to have one on
    // Gemini instead; counting both would double the session tally.
    expect(incOf(patch, 'voiceSessions')).toBe(0);
  });

  it('prices the model the server minted, not the one the client names', async () => {
    await runVoiceReport({
      model: 'openai/something-cheaper', conversationId: 'oa_1',
      durationSeconds: 90, usage: OA_SESSION,
    });
    expect(incOf(patchAt(USAGE_PATH), 'models.openai_gpt-realtime-2_1.voiceCostMicros'))
      .toBe(OA_SESSION_MICROS);
  });

  it('refuses to settle the same session twice', async () => {
    store.docs.set('voiceSessions/oa_1', {
      uid: 'u1', plan: 'pro', model: OA_MODEL, heldSeconds: 120,
      settledAt: {}, settledSeconds: 90,
    });
    const res = await runVoiceReport({
      model: OA_MODEL, conversationId: 'oa_1', durationSeconds: 90, usage: OA_SESSION,
    });
    expect(res).toMatchObject({ alreadySettled: true, costMicros: 0 });
    expect(store.writes).toHaveLength(0);
  });

  it('clamps a client claiming more tokens than an hour of audio could produce', async () => {
    await runVoiceReport({
      model: OA_MODEL, conversationId: 'oa_1', durationSeconds: 90,
      usage: { outputAudioTokens: 50_000_000 },
    });
    // Capped at 5M tokens @ $64/M = $320, not the $3,200 it asked for.
    expect(incOf(patchAt(USAGE_PATH), 'models.openai_gpt-realtime-2_1.voiceCostMicros'))
      .toBe(320_000_000);
  });
});

describe('reportAssistantVoiceUsage: a client that sends a payload it should not', () => {
  beforeEach(() => {
    store.docs.set('voiceSessions/conv_1', {
      uid: 'u1', plan: 'pro', model: 'elevenlabs/claude-sonnet-5', heldSeconds: 120,
    });
    store.docs.set(USAGE_PATH, { voiceSeconds: 120 });
  });

  it('ignores tokens reported against a per-minute session', async () => {
    // End to end: the model comes off the session doc, so this is an
    // ElevenLabs settle no matter what the caller says, and its cost must stay
    // the 60 seconds it actually ran.
    await runVoiceReport({
      model: 'elevenlabs/claude-sonnet-5', conversationId: 'conv_1',
      durationSeconds: 60, holdSeconds: 120, endReason: 'ended',
      usage: { inputTextTokens: 5_000_000, outputTextTokens: 5_000_000 },
    });
    const patch = patchAt(USAGE_PATH);
    expect(incOf(patch, 'costMicros')).toBe(platformCostMicros('elevenlabs/claude-sonnet-5', 60));
    expect(patch.voiceInputTextTokens).toBeUndefined();
  });

  it('books nothing for a zero-second report carrying a fortune in tokens', async () => {
    await runVoiceReport({
      model: OA_MODEL, conversationId: 'made-up', durationSeconds: 0,
      usage: { outputAudioTokens: 5_000_000 },
      transcriptionSeconds: 600,
    });
    expect(incOf(patchAt(DAILY_PATH), 'costMicros')).toBe(0);
  });

  it('still counts a per-minute conversation that rounded down to zero seconds', async () => {
    // The webhook only back-fills the session count for a session the client
    // never reported (elevenLabsWebhook: `if (!session.settledAt)`), and this
    // call writes settledAt. Skipping the count here would lose a real
    // conversation from the tally permanently.
    await runVoiceReport({
      model: 'elevenlabs/claude-sonnet-5', conversationId: 'conv_1',
      durationSeconds: 0, holdSeconds: 120, endReason: 'ended',
    });
    expect(incOf(patchAt(USAGE_PATH), 'voiceSessions')).toBe(1);
  });
});

describe('reportAssistantVoiceUsage: the ElevenLabs path is unchanged', () => {
  it('still books one per-minute line and no token counters', async () => {
    store.docs.set('voiceSessions/conv_1', {
      uid: 'u1', plan: 'pro', model: 'elevenlabs/claude-sonnet-5', heldSeconds: 120,
    });
    store.docs.set(USAGE_PATH, { voiceSeconds: 120 });

    await runVoiceReport({
      model: 'elevenlabs/claude-sonnet-5', conversationId: 'conv_1',
      durationSeconds: 360, holdSeconds: 120, endReason: 'ended',
    });

    const patch = patchAt(USAGE_PATH);
    // 6 minutes of platform time plus the one-off cache write.
    expect(incOf(patch, 'models.elevenlabs_claude-sonnet-5.voiceCostMicros')).toBe(542_000);
    expect(incOf(patch, 'costMicros')).toBe(542_000);
    expect(patch.voiceSeconds).toBe(360);
    // A provider that bills minutes reports no tokens, so no token field is
    // written at all — an inc(0) on every ElevenLabs session would be noise.
    expect(patch.voiceInputAudioTokens).toBeUndefined();
    expect(patch.voiceCachedTokens).toBeUndefined();
  });
});
