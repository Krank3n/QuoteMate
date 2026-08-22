// Pure sliding-window rate-limit arithmetic. Extracted from the transaction
// body in assistantToken's checkRateLimit so the prune/allow/append decision
// can be unit tested without Firestore.

export interface RateLimitWindowConfig {
  maxRequests: number;
  windowMs: number;
}

// On deny the caller must NOT persist `timestamps` — leaving expired entries
// in the doc is harmless (they're re-pruned next call) and writing on deny
// would let a hammering client keep the doc hot for free.
export type WindowDecision =
  | { allowed: true; timestamps: number[] }
  | { allowed: false; timestamps: number[] };

/** Prune expired timestamps, deny at maxRequests, append `now` on allow. */
export function decideRateLimitWindow(
  existing: number[] | undefined,
  now: number,
  cfg: RateLimitWindowConfig,
): WindowDecision {
  const live = (existing ?? []).filter((t) => t > now - cfg.windowMs);
  if (live.length >= cfg.maxRequests) return { allowed: false, timestamps: live };
  return { allowed: true, timestamps: [...live, now] };
}
