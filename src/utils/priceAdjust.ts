/**
 * Price adjustment helpers — pure, side-effect-free.
 *
 * Used by the supplier price-list import flow and the standalone
 * BulkPriceAdjustScreen to apply:
 *   - An annual percentage uplift across every saved price (e.g. supplier
 *     announces +5.8%).
 *   - A GST mode flip when a price book was stored ex-GST but the business
 *     wants inc-GST (or vice versa).
 *
 * All amounts are rounded to 2 decimal places (cents). Inputs that aren't
 * finite numbers return 0 — the surrounding UI is responsible for not
 * persisting a 0 unless the user explicitly typed one.
 */

export const DEFAULT_GST_RATE = 0.10;

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Half-away-from-zero rounding to keep .005 → .01 instead of banker's rounding.
  return Math.round(n * 100) / 100;
}

/**
 * Apply a percentage uplift (or reduction) to a price.
 *
 * @param price   Original unit price.
 * @param percent +5.8 for a 5.8% increase, -2 for a 2% decrease, 0 for no-op.
 * @returns       New unit price, rounded to cents.
 */
export function applyPercentUplift(price: number, percent: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(percent)) return 0;
  if (price === 0 || percent === 0) return round2(price);
  return round2(price * (1 + percent / 100));
}

/**
 * Convert an ex-GST price to inc-GST.
 *
 * @param priceExGst The ex-GST price.
 * @param gstRate    GST rate as a decimal (default 0.10 = 10% AU GST).
 */
export function convertExToInc(priceExGst: number, gstRate: number = DEFAULT_GST_RATE): number {
  if (!Number.isFinite(priceExGst) || !Number.isFinite(gstRate)) return 0;
  return round2(priceExGst * (1 + gstRate));
}

/**
 * Convert an inc-GST price to ex-GST.
 *
 * @param priceIncGst The inc-GST price.
 * @param gstRate     GST rate as a decimal (default 0.10 = 10% AU GST).
 */
export function convertIncToEx(priceIncGst: number, gstRate: number = DEFAULT_GST_RATE): number {
  if (!Number.isFinite(priceIncGst) || !Number.isFinite(gstRate)) return 0;
  if (1 + gstRate === 0) return 0;
  return round2(priceIncGst / (1 + gstRate));
}

export type GstAction = 'addGst' | 'removeGst' | 'none';

/**
 * Apply a percentage uplift followed by an optional GST action.
 * Convenience wrapper so callers don't reimplement the order of operations.
 *
 * Order: uplift first, then GST — matches Jesse's mental model
 * ("supplier price rises by 5.8%, then add GST on top").
 */
export function adjustPrice(
  price: number,
  opts: { percent?: number; gstAction?: GstAction; gstRate?: number }
): number {
  const { percent = 0, gstAction = 'none', gstRate = DEFAULT_GST_RATE } = opts;
  let next = applyPercentUplift(price, percent);
  if (gstAction === 'addGst') next = convertExToInc(next, gstRate);
  else if (gstAction === 'removeGst') next = convertIncToEx(next, gstRate);
  return next;
}
