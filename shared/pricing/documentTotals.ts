/**
 * Document totals, labour derivation and the quote-level recalculation.
 *
 * Moved out of src/utils/documentCalculator.ts and quoteCalculator.ts so the
 * server-side pricing run can write a quote whose totals match what the app
 * would compute. The app modules re-export everything here.
 */

import type { JobSpec, LaborUnit, Material, QuoteSection } from './types';
import { markupableLabourTotal, markupableMaterialsTotal } from '../document/lumpSum';
import { roundToTwoDecimals } from './money';

const STANDARD_DAY_HOURS = 8;

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

/** Quote-level totals (the app's QuoteCalculation shape). */
export interface QuoteTotals {
  materialsSubtotal: number;
  laborTotal: number;
  subtotal: number;
  markupAmount: number;
  travelAdjustmentAmount: number;
  gst: number;
  total: number;
}

/**
 * Calculate quote totals.
 */
export function calculateQuote(
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
): QuoteTotals {
  const calc = calculateDocumentTotals(
    materials,
    laborRate,
    laborHours,
    markupPercent,
    travelAdjustment,
    sections,
    laborMarkupPercent,
    laborExtraHours,
    pricesIncludeGst,
    gstRegistered,
  );
  return {
    materialsSubtotal: calc.materialsSubtotal,
    laborTotal: calc.laborTotal,
    subtotal: calc.subtotal,
    markupAmount: calc.markupAmount,
    travelAdjustmentAmount: calc.travelAdjustmentAmount,
    gst: calc.gst,
    total: calc.total,
  };
}

/**
 * Recovery for the "$0 labour bug" — quotes that ended up with one or more
 * sections at laborTotal: 0. Two branches:
 *
 *  1. ALL-ZERO — legacy case (pre-sectionLaborHours fix). The user set
 *     top-level labour from LaborMarkupScreen but no section absorbed it.
 *     Redistribute the top-level hours across every section proportional
 *     to multiplier.
 *
 *  2. PARTIAL-ZERO — some sections have real labour, some are zero (e.g.
 *     a per-m² "Paver Installation" section the AI returned with 0 hours).
 *     If top-level (laborHours × laborRate) exceeds the sum of non-zero
 *     section totals, the gap belongs to the zero sections — distribute
 *     it across them proportional to multiplier, using the rate/unit of
 *     the first non-zero section (since per-section rate is normally
 *     uniform across a single quote).
 *
 * Both branches require top-level laborHours × laborRate > 0. If no
 * top-level value is set there's nothing to redistribute and the quote
 * passes through unchanged.
 *
 * LUMP-SUM SECTIONS ARE INVISIBLE TO THIS FUNCTION. Their laborTotal is a
 * number the tradie typed, not a broken derivation, so they are neither
 * counted when deciding whether labour looks broken nor written to when it
 * does. Healing one would replace the tradie's price with hours × a rate that
 * is deliberately 0.
 */
export function healBrokenLabourSections<T extends { sections?: QuoteSection[]; laborHours: number; laborRate: number }>(quote: T): T {
  if (!quote.sections || quote.sections.length === 0) return quote;
  const topLevelTotal = (quote.laborHours || 0) * (quote.laborRate || 0);
  if (topLevelTotal <= 0) return quote;

  const hourlySections = quote.sections.filter((s) => s.pricing !== 'lumpSum');
  if (hourlySections.length === 0) return quote;

  const allZero = hourlySections.every((s) => (s.laborTotal || 0) === 0);
  if (allZero) {
    const sumMul = hourlySections.reduce((sum, s) => sum + (s.multiplier || 1), 0);
    if (sumMul <= 0) return quote;
    const perUnitHours = (quote.laborHours || 0) / sumMul;
    const rate = quote.laborRate || 0;
    const healedSections = quote.sections.map((s) => {
      if (s.pricing === 'lumpSum') return s;
      const mul = s.multiplier || 1;
      return {
        ...s,
        laborHours: perUnitHours,
        laborHoursTotal: roundToTwoDecimals(perUnitHours * mul),
        laborRate: rate,
        laborUnit: s.laborUnit || 'hours',
        laborTotal: roundToTwoDecimals(perUnitHours * rate * mul),
      };
    });
    return { ...quote, sections: healedSections };
  }

  // Partial-zero path
  const zeroSections = hourlySections.filter((s) => (s.laborTotal || 0) === 0);
  if (zeroSections.length === 0) return quote;

  // Lump-sum dollars are excluded from the gap arithmetic too: they are not
  // hourly labour, so counting them would shrink the gap and under-heal the
  // sections that genuinely are broken.
  const sumNonZero = hourlySections.reduce((sum, s) => sum + (s.laborTotal || 0), 0);
  const gap = topLevelTotal - sumNonZero;
  if (gap <= 0) return quote;

  const sumZeroMul = zeroSections.reduce((sum, s) => sum + (s.multiplier || 1), 0);
  if (sumZeroMul <= 0) return quote;

  // Inherit rate/unit from a non-zero section so distributed hours are
  // expressed in the same units as the rest of the quote. Fall back to
  // top-level values when nothing else is available.
  const reference = hourlySections.find((s) => (s.laborTotal || 0) > 0);
  const rate = reference?.laborRate ?? quote.laborRate ?? 0;
  const unit = reference?.laborUnit ?? 'hours';
  if (rate <= 0) return quote;

  const totalUnits = gap / rate;
  const perUnitForZero = totalUnits / sumZeroMul;
  const healedSections = quote.sections.map((s) => {
    if (s.pricing === 'lumpSum') return s;
    if ((s.laborTotal || 0) > 0) return s;
    const mul = s.multiplier || 1;
    return {
      ...s,
      laborHours: perUnitForZero,
      laborHoursTotal: roundToTwoDecimals(perUnitForZero * mul),
      laborRate: rate,
      laborUnit: unit,
      laborTotal: roundToTwoDecimals(perUnitForZero * rate * mul),
    };
  });
  return { ...quote, sections: healedSections };
}

/** The fields recalculateQuoteTotals reads and writes. Quote and Document both satisfy it. */
export interface RecalculableQuote {
  job: JobSpec;
  materials: Material[];
  laborRate: number;
  laborHours: number;
  laborUnit?: LaborUnit;
  laborExtraHours?: number;
  markup: number;
  laborMarkup?: number;
  travelAdjustment?: number;
  sections?: QuoteSection[];
  pricesIncludeGst?: boolean;
  gstRegistered?: boolean;
}

/**
 * Heal broken labour sections, then recompute every total from the lines.
 * The app's updateQuoteCalculations is this plus a fresh updatedAt; the
 * server-side pricing run uses it directly so a quote it writes carries the
 * same totals the app would have written.
 */
export function recalculateQuoteTotals<Q extends RecalculableQuote>(quote: Q): Q {
  const healed = healBrokenLabourSections(quote);
  const calculation = calculateQuote(
    healed.materials,
    healed.laborRate,
    healed.laborHours,
    healed.markup,
    healed.travelAdjustment || 0,
    healed.sections,
    healed.laborMarkup ?? healed.markup ?? 0,
    healed.laborExtraHours ?? 0,
    healed.pricesIncludeGst === true,
    healed.gstRegistered !== false,
  );
  return {
    ...healed,
    job: syncJobEstimatedHours(healed),
    materialsSubtotal: calculation.materialsSubtotal,
    laborTotal: calculation.laborTotal,
    subtotal: calculation.subtotal,
    markupAmount: calculation.markupAmount,
    gst: calculation.gst,
    total: calculation.total,
  };
}

/**
 * Zero the labour on a quote whose labour is charged through rate lines,
 * otherwise the analysis pass's hours × rate lands on top of the rate. The
 * sections become lump sums: an hourly section with no hours is exactly the
 * shape the integrity check flags as broken.
 */
export function stripLabourFromQuote<T extends { laborHours: number; sections?: QuoteSection[] }>(quote: T): T {
  return {
    ...quote,
    laborHours: 0,
    sections: (quote.sections ?? []).map((s) => ({
      ...s,
      pricing: 'lumpSum' as const,
      laborHours: 0,
      laborHoursTotal: 0,
      laborTotal: 0,
    })),
  };
}
