/**
 * Document calculation utilities
 *
 * Canonical home for the helpers that work the same on quotes and invoices
 * (currency formatting, markup math, generic profit math). Type-specific
 * helpers (isInvoiceOverdue, calculateDueDate) live in invoiceCalculator,
 * and the quote-specific calculation helpers (calculateQuote,
 * updateQuoteCalculations, etc.) live in quoteCalculator. Both re-export
 * from here so existing callers don't need to change their imports.
 */

import type { Document } from '../types/document';
import {
  calculateDocumentTotals,
  syncJobEstimatedHours,
} from '../../shared/pricing/documentTotals';
import { roundToTwoDecimals } from '../../shared/pricing/money';

// The arithmetic moved to shared/pricing so the server-side pricing run and
// the app compute one set of totals. Re-exported here for existing callers.
export { roundToTwoDecimals, supplierPriceForGstMode } from '../../shared/pricing/money';
export {
  updateMaterialTotalPrice,
  updateAllMaterialPrices,
  calculateDocumentTotals,
  deriveTotalLabourHours,
  syncJobEstimatedHours,
} from '../../shared/pricing/documentTotals';

/** Format a number as Australian Dollars. */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Effective hourly rate = total revenue / labor hours. */
export function calculateEffectiveHourlyRate(totalRevenue: number, laborHours: number): number {
  if (laborHours === 0) return 0;
  return roundToTwoDecimals(totalRevenue / laborHours);
}

/** Profit margin = (total - costs) / total × 100. */
export function calculateProfitMargin(total: number, costs: number): number {
  if (total === 0) return 0;
  const profit = total - costs;
  return roundToTwoDecimals((profit / total) * 100);
}

/** Recalculate and merge totals onto a Document in place. */
export function updateDocumentCalculations(doc: Document): Document {
  const calc = calculateDocumentTotals(
    doc.materials,
    doc.laborRate,
    doc.laborHours,
    doc.markup,
    doc.travelAdjustment || 0,
    doc.sections,
    doc.laborMarkup ?? doc.markup ?? 0,
    doc.laborExtraHours ?? 0,
    doc.pricesIncludeGst === true,
    doc.gstRegistered !== false,
  );
  return {
    ...doc,
    job: syncJobEstimatedHours(doc),
    materialsSubtotal: calc.materialsSubtotal,
    laborTotal: calc.laborTotal,
    subtotal: calc.subtotal,
    markupAmount: calc.markupAmount,
    gst: calc.gst,
    total: calc.total,
    updatedAt: Date.now(),
  };
}
