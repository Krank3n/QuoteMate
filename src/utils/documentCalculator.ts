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

import { Material, QuoteSection, LaborUnit, JobSpec } from '../types';
import type { Document } from '../types/document';
import { markupableLabourTotal, markupableMaterialsTotal } from '../../shared/document/lumpSum';

const STANDARD_DAY_HOURS = 8;

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

/** Format a number as Australian Dollars. */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Refresh a single material's totalPrice from quantity × price. */
export function updateMaterialTotalPrice(material: Material): Material {
  return {
    ...material,
    totalPrice: roundToTwoDecimals(material.quantity * material.price),
  };
}

/** Refresh totalPrice on every material in the list. */
export function updateAllMaterialPrices(materials: Material[]): Material[] {
  return materials.map(updateMaterialTotalPrice);
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
 * Apply the same line-totals → markup → GST → grand-total math used by both
 * the quote and invoice flows. Returns the calculated subtotal/markup/gst
 * ready to be merged onto the document.
 */
export function calculateDocumentTotals(
  materials: Material[],
  laborRate: number,
  laborHours: number,
  markupPercent: number,
  travelAdjustment: number = 0,
  sections?: QuoteSection[],
  laborMarkupPercent: number = 0,
  laborExtraHours: number = 0,
  pricesIncludeGst: boolean = false,
  gstRegistered: boolean = true,
): {
  materialsSubtotal: number;
  laborTotal: number;
  subtotal: number;
  markupAmount: number;
  travelAdjustmentAmount: number;
  gst: number;
  total: number;
} {
  const materialsSubtotal = materials.reduce((sum, m) => sum + m.totalPrice, 0);
  const laborTotal = sections && sections.length > 0
    ? sections.reduce((sum, s) => sum + s.laborTotal, 0) + (laborExtraHours * laborRate)
    : laborRate * laborHours;
  const subtotal = materialsSubtotal + laborTotal;
  // Work items are exempt for the same reason lump-sum sections are: the price
  // is one the tradie typed into a field labelled "Line total", not a supplier
  // price we marked up on their behalf. See shared/document/lumpSum.ts.
  const materialMarkupAmount =
    markupableMaterialsTotal(materialsSubtotal, materials) * (markupPercent / 100);
  // Lump-sum sections are exempt: their laborTotal is a price the tradie
  // typed, so marking it up would charge the customer a number the tradie
  // never chose. See shared/document/lumpSum.ts.
  const laborMarkupAmount = markupableLabourTotal(laborTotal, sections) * (laborMarkupPercent / 100);
  const markupAmount = materialMarkupAmount + laborMarkupAmount;
  const travelAdjustmentAmount = subtotal * (travelAdjustment / 100);
  const subtotalWithMarkup = subtotal + markupAmount + travelAdjustmentAmount;
  // Not registered: no GST at all → total is just the subtotal.
  // Inclusive: line prices already include GST → total stays at subtotal,
  // GST is extracted as 1/11 for tax-invoice disclosure.
  // Exclusive: line prices are ex-GST → 10% GST is added on top.
  const total = !gstRegistered || pricesIncludeGst
    ? subtotalWithMarkup
    : subtotalWithMarkup * 1.1;
  const gst = !gstRegistered
    ? 0
    : pricesIncludeGst
      ? total - total / 1.1
      : subtotalWithMarkup * 0.1;
  return {
    materialsSubtotal: roundToTwoDecimals(materialsSubtotal),
    laborTotal: roundToTwoDecimals(laborTotal),
    subtotal: roundToTwoDecimals(subtotal),
    markupAmount: roundToTwoDecimals(markupAmount),
    travelAdjustmentAmount: roundToTwoDecimals(travelAdjustmentAmount),
    gst: roundToTwoDecimals(gst),
    total: roundToTwoDecimals(total),
  };
}

/**
 * Coerce any field to a finite number. NaN and Infinity become 0 so they
 * never propagate into Firestore writes — the SDK rejects non-finite values
 * silently, which used to surface as orphan Jobs created without their
 * matching Quote when this function returned NaN for `estimatedHours`.
 */
function finiteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convert a labour value to hours given its unit. Days are billed as
 * STANDARD_DAY_HOURS (8h) for the purpose of the JobSpec.estimatedHours
 * field, which is the unit the rest of the app (scheduling, GCal export)
 * already assumes.
 */
function laborValueToHours(value: unknown, unit: LaborUnit | undefined): number {
  const n = finiteNumber(value);
  return unit === 'days' ? n * STANDARD_DAY_HOURS : n;
}

/**
 * Recompute total labour hours for a document from the source of truth —
 * sections + laborExtraHours when sections exist, otherwise the top-level
 * laborHours field. Used to keep JobSpec.estimatedHours in sync so the
 * "est. Xh" header doesn't drift from the actual labour billed.
 *
 * NaN-safe — any non-finite field is treated as 0. A single corrupt section
 * value used to poison the whole computation and bubble NaN up to
 * JobSpec.estimatedHours, causing every saveQuote() Firestore write to
 * silently fail until the user manually edited the field.
 */
export function deriveTotalLabourHours<
  T extends {
    sections?: QuoteSection[];
    laborHours: number;
    laborUnit?: LaborUnit;
    laborExtraHours?: number;
  },
>(doc: T): number {
  const hasSections = Array.isArray(doc.sections) && doc.sections.length > 0;
  if (hasSections) {
    const sectionHours = doc.sections!.reduce((sum, s) => {
      const candidate = typeof s.laborHoursTotal === 'number' && Number.isFinite(s.laborHoursTotal)
        ? s.laborHoursTotal
        : finiteNumber(s.laborHours) * (finiteNumber(s.multiplier) || 1);
      return sum + laborValueToHours(candidate, s.laborUnit);
    }, 0);
    const extra = laborValueToHours(doc.laborExtraHours, doc.laborUnit);
    return sectionHours + extra;
  }
  return laborValueToHours(doc.laborHours, doc.laborUnit);
}

/**
 * Resync JobSpec.estimatedHours from the document's labour data. Sections
 * (when present) are the source of truth; the field on JobSpec is just a
 * cached headline number. Returns a new JobSpec object only when the value
 * changed, so callers can preserve referential equality otherwise.
 *
 * If the derivation yields a non-finite result for any reason, the existing
 * JobSpec is returned unchanged. Better to leave the stored value alone than
 * to write NaN/Infinity into Firestore (the SDK rejects, breaking the whole
 * quote save).
 */
export function syncJobEstimatedHours<
  T extends {
    job: JobSpec;
    sections?: QuoteSection[];
    laborHours: number;
    laborUnit?: LaborUnit;
    laborExtraHours?: number;
  },
>(doc: T): JobSpec {
  const totalHours = deriveTotalLabourHours(doc);
  if (!Number.isFinite(totalHours)) return doc.job;
  const rounded = Math.round(totalHours);
  if (doc.job.estimatedHours === rounded) return doc.job;
  return { ...doc.job, estimatedHours: rounded };
}

/**
 * Recalculate and merge totals onto a Document in place.
 *
 * Every numeric input is coerced through finiteNumber: a document that reached
 * here from an untyped source (a legacy import, a partial test fixture, a row
 * that never had a rate stamped) must not turn one undefined field into a NaN
 * total — Firestore rejects the write silently and the tradie's edit is lost.
 * Materials are re-totalled from quantity × price first, so a row whose unit
 * price changed without its totalPrice can't leave the subtotal stale.
 */
export function updateDocumentCalculations(doc: Document): Document {
  const materials = (Array.isArray(doc.materials) ? doc.materials : []).map((m) => ({
    ...m,
    totalPrice: roundToTwoDecimals(finiteNumber(m.quantity) * finiteNumber(m.price)),
  }));
  const calc = calculateDocumentTotals(
    materials,
    finiteNumber(doc.laborRate),
    finiteNumber(doc.laborHours),
    finiteNumber(doc.markup),
    finiteNumber(doc.travelAdjustment),
    doc.sections,
    finiteNumber(doc.laborMarkup ?? doc.markup),
    finiteNumber(doc.laborExtraHours),
    doc.pricesIncludeGst === true,
    doc.gstRegistered !== false,
  );
  return {
    ...doc,
    materials,
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
