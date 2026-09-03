/**
 * Money helpers the pricing pipeline and the document calculators share.
 * Moved out of src/utils/documentCalculator.ts so the server-side pricing run
 * rounds and converts exactly as the app does.
 */

/** Round a number to 2 decimal places. */
export function roundToTwoDecimals(num: number): number {
  return Math.round(num * 100) / 100;
}

/**
 * Reece, Bunnings, and the LLM pricing fallbacks all return GST-inclusive
 * Australian retail prices. When the business is in exclusive (+GST) mode,
 * the line item the tradie sees should be ex-GST so the totals row reads
 * "Subtotal + 10% GST = Total" without double-counting. In inclusive mode
 * we keep the price as-is.
 */
export function supplierPriceForGstMode(incGstPrice: number, pricesIncludeGst: boolean): number {
  if (pricesIncludeGst) return incGstPrice;
  return roundToTwoDecimals(incGstPrice / 1.1);
}
