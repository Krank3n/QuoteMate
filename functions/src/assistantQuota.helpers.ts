// Pure quota arithmetic for Mate's daily turn allowance. Extracted from the
// transaction bodies in assistantToken so reserve/refund stay in lockstep and
// can be unit tested without Firestore.
//
// A "turn" is reserved BEFORE the paid downstream call (Gemini generateContent
// or an ephemeral-token mint). If that call then fails, the endpoint refunds
// the turn — a failed request must not eat into a free user's 20/day.

export const QUOTA = {
  free: { turns: 20, voiceSeconds: 300 },
  trial: { turns: 200, voiceSeconds: 1800 },
  pro: { turns: 200, voiceSeconds: 2700 },
} as const;

export type Plan = keyof typeof QUOTA;

export interface UsageDocData {
  turns?: number;
  outputTokens?: number;
  inputTokens?: number;
  /** Seconds of voice conversation charged against today's budget. */
  voiceSeconds?: number;
}

/** UTC day key — quota resets at midnight UTC. */
export function todayKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
}

export type ReserveResult =
  | { ok: true; update: { turns: number; outputTokens: number; inputTokens: number; plan: Plan } }
  | { ok: false; reason: string };

/** One more turn against today's doc, or a rejection with the user-facing reason. */
export function reserveTurnUpdate(data: Partial<UsageDocData> | undefined, plan: Plan): ReserveResult {
  const limit = QUOTA[plan];
  const turns = (data?.turns ?? 0) + 1;
  if (turns > limit.turns) {
    return {
      ok: false,
      reason: `You've hit today's Mate limit (${limit.turns} turns). It resets at midnight UTC.`,
    };
  }
  return {
    ok: true,
    update: {
      turns,
      outputTokens: data?.outputTokens ?? 0,
      inputTokens: data?.inputTokens ?? 0,
      plan,
    },
  };
}

/**
 * Give back a reserved turn after the downstream call failed. Returns null
 * when there's nothing to refund — including the midnight-UTC edge where the
 * reserve landed on yesterday's doc and the refund runs against today's
 * fresh one (we'd rather leak one phantom turn than go negative).
 */
export function refundTurnUpdate(data: Partial<UsageDocData> | undefined): { turns: number } | null {
  const turns = data?.turns ?? 0;
  if (turns <= 0) return null;
  return { turns: turns - 1 };
}

// ---------------------------------------------------------------------------
// Voice minutes
//
// The turn quota alone was enough while voice ran on Gemini Live, where cost
// tracked tokens. An ElevenLabs Agent bills by the MINUTE ($0.08 platform +
// LLM on top), so a user can hold one very long conversation, spend real money,
// and never trouble a turn counter. Turns and seconds measure different things
// and both have to hold:
//
//   turns        = session starts (one mint = one turn, text or voice)
//   voiceSeconds = how long the voice sessions actually ran
//
// One voice session therefore costs 1 turn + N seconds. Neither derives from
// the other, and text still only ever consumes turns.
//
// HOLD-AND-SETTLE, not reserve-the-ceiling. Reserving a session's full duration
// cap up front would charge a twenty-second question eight minutes of budget,
// which is unusable. Reserving nothing until the session ends isn't a budget at
// all — a client could open unlimited back-to-back sessions before any of them
// reported. So: a small hold at mint, settled to the truth when the session
// ends. Structurally the same reserve/refund shape the turn quota already uses.
// ---------------------------------------------------------------------------

/**
 * Held at mint, refunded down to actual on settle. At roughly $0.12/min all-in
 * that is about 24 cents parked per session start: enough that a mint storm
 * self-limits, small enough that a short question barely dents the day.
 *
 * A session that never reports (app killed, coverage gone) leaves this held
 * permanently. That is the correct direction to fail — a slight over-charge
 * beats a crash-looping client talking for free — and it clears at midnight UTC.
 */
export const VOICE_HOLD_SECONDS = 120;

/**
 * Hard ceiling on a single conversation, per plan. Bounds the damage from one
 * runaway session; the daily budget bounds the damage from many.
 */
export const MAX_SESSION_SECONDS: Record<Plan, number> = {
  free: 300,
  trial: 600,
  pro: 900,
};

/** Seconds of voice left today. Never negative. */
export function remainingVoiceSeconds(data: Partial<UsageDocData> | undefined, plan: Plan): number {
  return Math.max(0, QUOTA[plan].voiceSeconds - (data?.voiceSeconds ?? 0));
}

export type VoiceReserveResult =
  | { ok: true; update: { voiceSeconds: number; plan: Plan }; heldSeconds: number }
  | { ok: false; reason: string };

/**
 * Park a hold against today's budget before opening a session.
 *
 * Refuses when the hold doesn't fit, rather than when the budget is exactly
 * spent — starting a session with ten seconds of budget left just spends the
 * mint and cuts the tradie off mid-sentence.
 */
export function reserveVoiceSecondsUpdate(
  data: Partial<UsageDocData> | undefined,
  plan: Plan,
  holdSeconds: number = VOICE_HOLD_SECONDS,
): VoiceReserveResult {
  const limit = QUOTA[plan].voiceSeconds;
  const used = data?.voiceSeconds ?? 0;
  if (used + holdSeconds > limit) {
    const mins = Math.round(limit / 60);
    return {
      ok: false,
      reason: `You've used up today's talk time with Mate (${mins} minutes). It resets at midnight UTC — you can still type to Mate in the meantime.`,
    };
  }
  return {
    ok: true,
    update: { voiceSeconds: used + holdSeconds, plan },
    heldSeconds: holdSeconds,
  };
}

/**
 * Hand back a hold whose session never happened — the ElevenLabs token mint
 * failed, or the turn reserve that runs after this one refused. Mirrors
 * refundTurnUpdate, including returning null when there's nothing to give back
 * (the midnight-UTC edge, where the reserve landed on yesterday's doc).
 */
export function refundVoiceSecondsUpdate(
  data: Partial<UsageDocData> | undefined,
  seconds: number,
): { voiceSeconds: number } | null {
  const used = data?.voiceSeconds ?? 0;
  if (used <= 0 || seconds <= 0) return null;
  return { voiceSeconds: Math.max(0, used - seconds) };
}

/**
 * Replace the hold with what the session actually cost.
 *
 * `actualSeconds` is clamped to the plan's session ceiling before it lands, so
 * a misbehaving client can't inflate the day's usage past what the agent would
 * ever have allowed. Returns null when there's nothing to adjust.
 */
export function settleVoiceSecondsUpdate(
  data: Partial<UsageDocData> | undefined,
  args: { plan: Plan; holdSeconds: number; actualSeconds: number },
): { voiceSeconds: number } | null {
  const ceiling = MAX_SESSION_SECONDS[args.plan];
  const actual = Math.min(Math.max(0, Math.round(args.actualSeconds)), ceiling);
  const delta = actual - Math.max(0, args.holdSeconds);
  if (delta === 0) return null;
  const used = data?.voiceSeconds ?? 0;
  return { voiceSeconds: Math.max(0, used + delta) };
}
