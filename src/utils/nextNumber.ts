/**
 * Derives the next sequential reference number from a set of existing
 * items, scanning e.g. "Q-001", "Q-017", "INV-042" formatted fields.
 *
 * Why it exists: the in-app counters (nextQuoteNumber / nextInvoiceNumber)
 * are cached in AsyncStorage on the current device. A fresh install or
 * first sign-in on a second device starts that counter at 1 — which would
 * mint a new Q-001 colliding with the Q-001 already in Firestore from
 * another device. Reconciling against the actually-persisted numbers fixes
 * both cases.
 */

/** Extract the numeric suffix of a "PREFIX-123" reference, null if no match. */
export function parseRefNumber(value: string | undefined | null, prefix: string): number | null {
  if (!value) return null;
  // Case-insensitive so legacy data with "q-001" matches "Q-001" etc.
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  const m = value.trim().match(re);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Compute the next sequential number for a prefix given a list of items
 * and the field to read off each item. Reconciles with a cached value so
 * the cache is still respected when it's ahead of the observed max (e.g.
 * the tradie manually bumped the counter).
 */
export function reconcileNextNumber<T>(params: {
  items: T[];
  field: (item: T) => string | undefined;
  prefix: string;
  cached: number;
}): number {
  const { items, field, prefix, cached } = params;
  let derivedMax = 0;
  for (const item of items) {
    const n = parseRefNumber(field(item), prefix);
    if (n !== null && n > derivedMax) derivedMax = n;
  }
  return Math.max(cached, derivedMax + 1);
}

/**
 * Pick the next-quote-number from multiple counter sources: the device's
 * cached counter, the in-memory value, and (for accounts restored after the
 * July 2026 deletion incident) a cloud floor written by the reclaim
 * function from the account's recovered sent-quote history — so numbering
 * continues where it left off instead of restarting at 1 and colliding
 * with numbers customers already hold. Highest valid candidate wins.
 */
export function resolveNextQuoteNumber(
  ...candidates: Array<number | null | undefined>
): number | null {
  const valid = candidates
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 1)
    .map(Math.floor);
  return valid.length ? Math.max(...valid) : null;
}
