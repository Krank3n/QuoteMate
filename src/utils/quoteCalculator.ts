/**
 * Quote calculation utilities
 * Handles pricing calculations with GST for Australian quotes
 */

import { Material, Quote, QuoteSection, QuoteCalculation } from '../types';

/**
 * Calculate quote totals
 * @param materials - List of materials with prices
 * @param laborRate - Hourly/daily labor rate
 * @param laborHours - Number of hours/days
 * @param markupPercent - Material markup percentage (e.g., 20 for 20%)
 * @param travelAdjustment - Travel adjustment percentage
 * @param sections - Optional sections with per-section labor
 * @param laborMarkupPercent - Labor markup percentage (independent from material markup)
 * @param laborExtraHours - Extra labour hours added on top of (or subtracted from) sections sum. Can be negative.
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
  // Calculate materials subtotal
  const materialsSubtotal = materials.reduce((sum, material) => {
    return sum + material.totalPrice;
  }, 0);

  // Calculate labor total — from sections if available (plus any extra),
  // otherwise simple rate × hours.
  const laborTotal = sections && sections.length > 0
    ? sections.reduce((sum, s) => sum + s.laborTotal, 0) + (laborExtraHours * laborRate)
    : laborRate * laborHours;

  // Subtotal before markup
  const subtotal = materialsSubtotal + laborTotal;

  // Calculate combined markup: material markup on materials + labor markup on labor
  const materialMarkupAmount = materialsSubtotal * (markupPercent / 100);
  const laborMarkupAmount = laborTotal * (laborMarkupPercent / 100);
  const markupAmount = materialMarkupAmount + laborMarkupAmount;

  // Calculate travel adjustment amount separately
  const travelAdjustmentAmount = subtotal * (travelAdjustment / 100);

  // Subtotal with markup and travel adjustment (before GST)
  const subtotalWithMarkup = subtotal + markupAmount + travelAdjustmentAmount;

  // Calculate GST (10% in Australia)
  const gst = subtotalWithMarkup * 0.1;

  // Final total
  const total = subtotalWithMarkup + gst;

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

  // Per-unit hours is uniform across sections; each section's contribution
  // scales by its multiplier. sum(perUnit × mul × rate) === topLevelTotal.
  const perUnitHours = (quote.laborHours || 0) / sumMul;
  const rate = quote.laborRate || 0;
  const healedSections = quote.sections.map((s) => ({
    ...s,
    laborHours: perUnitHours,
    laborRate: rate,
    laborUnit: s.laborUnit || 'hours',
    laborTotal: roundToTwoDecimals(perUnitHours * rate * (s.multiplier || 1)),
  }));

  return { ...quote, sections: healedSections };
}

/**
 * Update a quote with new calculations
 * @param quote - The quote to update
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

/**
 * Update material total price
 * @param material - The material to update
 */
export function updateMaterialTotalPrice(material: Material): Material {
  return {
    ...material,
    totalPrice: roundToTwoDecimals(material.quantity * material.price),
  };
}

/**
 * Update all materials' total prices
 * @param materials - List of materials to update
 */
export function updateAllMaterialPrices(materials: Material[]): Material[] {
  return materials.map(updateMaterialTotalPrice);
}

/**
 * Format currency for display (Australian dollars)
 * @param amount - The amount to format
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Round a number to 2 decimal places
 * @param num - Number to round
 */
function roundToTwoDecimals(num: number): number {
  return Math.round(num * 100) / 100;
}

/**
 * Calculate the effective hourly rate after markup
 * This is useful for tradies to see what they're actually charging
 */
export function calculateEffectiveHourlyRate(
  totalRevenue: number,
  laborHours: number
): number {
  if (laborHours === 0) return 0;
  return roundToTwoDecimals(totalRevenue / laborHours);
}

/**
 * Calculate profit margin percentage
 */
export function calculateProfitMargin(
  total: number,
  costs: number
): number {
  if (total === 0) return 0;
  const profit = total - costs;
  return roundToTwoDecimals((profit / total) * 100);
}
