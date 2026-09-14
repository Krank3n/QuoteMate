/**
 * Quote calculation utilities
 *
 * Quote-specific helpers — calculation entry points and the legacy labour
 * heal. Generic helpers (formatCurrency, markup math, profit margin) live
 * in documentCalculator and are re-exported here so existing callers don't
 * need to update their import paths.
 */

import { Quote } from '../types';
import { recalculateQuoteTotals, travelPercentForCharge } from '../../shared/pricing/documentTotals';

export {
  formatCurrency,
  roundToTwoDecimals,
  updateMaterialTotalPrice,
  updateAllMaterialPrices,
  calculateEffectiveHourlyRate,
  calculateProfitMargin,
  supplierPriceForGstMode,
} from './documentCalculator';
// The calculation and the labour heal live in shared/pricing so the
// server-side pricing run writes the same totals the app does.
export { calculateQuote, healBrokenLabourSections } from '../../shared/pricing/documentTotals';

/**
 * Update a quote with new calculations.
 */
export function updateQuoteCalculations(quote: Quote): Quote {
  return {
    ...recalculateQuoteTotals(quote),
    updatedAt: new Date(),
  };
}

/**
 * Put a travel charge the tradie stated in DOLLARS onto a quote as the same
 * travel adjustment the Labour & Markup screen edits, and re-run the totals.
 *
 * The charge is read against the quote's settled subtotal, so call this after
 * any other rate change on the same card and after pricing has landed —
 * a percent worked out against a half-priced quote is the wrong money.
 * Null when the quote has no subtotal to carry a charge yet.
 */
export function landTravelCharge(quote: Quote, dollars: number): Quote | null {
  const settled = updateQuoteCalculations(quote);
  const travelAdjustment = travelPercentForCharge(dollars, settled.subtotal);
  if (travelAdjustment === null) return null;
  return updateQuoteCalculations({ ...settled, travelAdjustment });
}
