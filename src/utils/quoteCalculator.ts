/**
 * Quote calculation utilities
 *
 * Quote-specific helpers — calculation entry points and the legacy labour
 * heal. Generic helpers (formatCurrency, markup math, profit margin) live
 * in documentCalculator and are re-exported here so existing callers don't
 * need to update their import paths.
 */

import { Quote } from '../types';
import { recalculateQuoteTotals } from '../../shared/pricing/documentTotals';

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
