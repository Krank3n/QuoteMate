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
} from './documentCalculator';

export {
  formatCurrency,
  updateMaterialTotalPrice,
  updateAllMaterialPrices,
  calculateEffectiveHourlyRate,
  calculateProfitMargin,
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
  laborExtraHours: number = 0
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
 * One-time recovery for the legacy "$0 labour bug" — quotes saved before the
 * sectionLaborHours fix had sections with laborTotal: 0 even though the user
 * had top-level labour values from LaborMarkupScreen. This helper detects that
 * exact broken state and redistributes the top-level labour back across the
 * sections proportionally to each section's multiplier, preserving the total.
 *
 * Heuristic is intentionally narrow:
 *   - Sections exist
 *   - EVERY section has laborTotal === 0 (no exceptions)
 *   - Top-level laborHours × laborRate > 0
 * Otherwise the quote is left untouched.
 */
export function healBrokenLabourSections<T extends { sections?: QuoteSection[]; laborHours: number; laborRate: number }>(quote: T): T {
  if (!quote.sections || quote.sections.length === 0) return quote;
  const allZero = quote.sections.every((s) => (s.laborTotal || 0) === 0);
  if (!allZero) return quote;
  const topLevelTotal = (quote.laborHours || 0) * (quote.laborRate || 0);
  if (topLevelTotal <= 0) return quote;

  const sumMul = quote.sections.reduce((sum, s) => sum + (s.multiplier || 1), 0);
  if (sumMul <= 0) return quote;

  const perUnitHours = (quote.laborHours || 0) / sumMul;
  const rate = quote.laborRate || 0;
  const healedSections = quote.sections.map((s) => {
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
    healed.laborExtraHours ?? 0
  );

  return {
    ...healed,
    materialsSubtotal: calculation.materialsSubtotal,
    laborTotal: calculation.laborTotal,
    subtotal: calculation.subtotal,
    markupAmount: calculation.markupAmount,
    gst: calculation.gst,
    total: calculation.total,
    updatedAt: new Date(),
  };
}
