/**
 * Quote calculation utilities
 *
 * Quote-specific helpers — calculation entry points and the legacy labour
 * heal. Generic helpers (formatCurrency, markup math, profit margin) live
 * in documentCalculator and are re-exported here so existing callers don't
 * need to update their import paths.
 */

import { Material, Quote, QuoteSection, QuoteCalculation } from '../types';
import {
  calculateDocumentTotals,
  roundToTwoDecimals,
  syncJobEstimatedHours,
} from './documentCalculator';

export {
  formatCurrency,
  roundToTwoDecimals,
  updateMaterialTotalPrice,
  updateAllMaterialPrices,
  calculateEffectiveHourlyRate,
  calculateProfitMargin,
  supplierPriceForGstMode,
} from './documentCalculator';

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
): QuoteCalculation {
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

/**
 * Update a quote with new calculations.
 */
export function updateQuoteCalculations(quote: Quote): Quote {
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
    updatedAt: new Date(),
  };
}
