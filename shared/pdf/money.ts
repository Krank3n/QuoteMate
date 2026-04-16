/**
 * Money helpers. All money crossing the Square API boundary must be integer
 * cents — Square's SDK and payment-link API take amounts as integer minor
 * units. Keeping conversions in one place prevents off-by-one rounding bugs
 * from spreading through the codebase.
 *
 * Rule of thumb: internal quote/invoice totals are stored as dollars
 * (legacy) but EVERY conversion to/from Square uses these helpers.
 */

/**
 * Convert dollars (float) to integer cents. Uses Math.round so 0.1 + 0.2
 * (= 0.30000000000000004) doesn't round down to 29 cents.
 */
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

/**
 * Convert integer cents to dollars (float). Rounded to 2dp so downstream
 * arithmetic doesn't reintroduce binary-float drift.
 */
export function centsToDollars(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}
