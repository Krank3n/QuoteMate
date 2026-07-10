// Pure quota arithmetic for Mate's daily turn allowance. Extracted from the
// transaction bodies in assistantToken so reserve/refund stay in lockstep and
// can be unit tested without Firestore.
//
// A "turn" is reserved BEFORE the paid downstream call (Gemini generateContent
// or an ephemeral-token mint). If that call then fails, the endpoint refunds
// the turn — a failed request must not eat into a free user's 20/day.

export const QUOTA = {
  free: { turns: 20 },
  trial: { turns: 200 },
  pro: { turns: 200 },
} as const;

export type Plan = keyof typeof QUOTA;

export interface UsageDocData {
  turns?: number;
  outputTokens?: number;
  inputTokens?: number;
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
