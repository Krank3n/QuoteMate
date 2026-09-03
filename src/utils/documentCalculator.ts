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

/**
 * Coerce any field to a finite number. NaN and Infinity become 0 so they
 * never propagate into Firestore writes — the SDK rejects non-finite values
 * silently, and the tradie's edit is lost.
 */
export function finiteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Recalculate and merge totals onto a Document in place.
 *
 * Every numeric input is coerced through finiteNumber: a document that reached
 * here from an untyped source (a legacy import, a partial test fixture, a row
 * that never had a rate stamped) must not turn one undefined field into a NaN
 * total — Firestore rejects the write silently and the tradie's edit is lost.
 * Materials are re-totalled from quantity × price first, so a row whose unit
 * price changed without its totalPrice can't leave the subtotal stale; a
 * section missing laborTotal is coerced too, since the calculator sums it raw.
 */
export function updateDocumentCalculations(doc: Document): Document {
  const materials = (Array.isArray(doc.materials) ? doc.materials : []).map((m) => ({
    ...m,
    totalPrice: roundToTwoDecimals(finiteNumber(m.quantity) * finiteNumber(m.price)),
  }));
  const sections = Array.isArray(doc.sections)
    ? doc.sections.map((s) => ({
        ...s,
        laborHours: finiteNumber(s.laborHours),
        laborRate: finiteNumber(s.laborRate),
        laborTotal: finiteNumber(s.laborTotal),
        multiplier: finiteNumber(s.multiplier) || 1,
      }))
    : doc.sections;
  const calc = calculateDocumentTotals(
    materials,
    finiteNumber(doc.laborRate),
    finiteNumber(doc.laborHours),
    finiteNumber(doc.markup),
    finiteNumber(doc.travelAdjustment),
    sections,
    finiteNumber(doc.laborMarkup ?? doc.markup),
    finiteNumber(doc.laborExtraHours),
    doc.pricesIncludeGst === true,
    doc.gstRegistered !== false,
  );
  return {
    ...doc,
    materials,
    ...(sections ? { sections } : {}),
    ...(doc.job ? { job: syncJobEstimatedHours(doc) } : {}),
    materialsSubtotal: calc.materialsSubtotal,
    laborTotal: calc.laborTotal,
    subtotal: calc.subtotal,
    markupAmount: calc.markupAmount,
    gst: calc.gst,
    total: calc.total,
    updatedAt: Date.now(),
  };
}
