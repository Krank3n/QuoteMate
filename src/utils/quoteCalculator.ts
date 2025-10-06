/**
 * Quote calculation utilities
 * Handles pricing calculations with GST for Australian quotes
 */

import { Material, Quote, QuoteCalculation } from '../types';

/**
 * Calculate quote totals
 * @param materials - List of materials with prices
 * @param laborRate - Hourly labor rate ($/hour)
 * @param laborHours - Number of hours
 * @param markupPercent - Markup percentage (e.g., 20 for 20%)
 */
export function calculateQuote(
  materials: Material[],
  laborRate: number,
  laborHours: number,
  markupPercent: number
): QuoteCalculation {
  // Calculate materials subtotal
  const materialsSubtotal = materials.reduce((sum, material) => {
    return sum + material.totalPrice;
  }, 0);

  // Calculate labor total
  const laborTotal = laborRate * laborHours;

  // Subtotal before markup
  const subtotal = materialsSubtotal + laborTotal;

  // Calculate markup
  const markupAmount = subtotal * (markupPercent / 100);

  // Subtotal with markup (before GST)
  const subtotalWithMarkup = subtotal + markupAmount;

  // Calculate GST (10% in Australia)
  const gst = subtotalWithMarkup * 0.1;

  // Final total
  const total = subtotalWithMarkup + gst;

  return {
    materialsSubtotal: roundToTwoDecimals(materialsSubtotal),
    laborTotal: roundToTwoDecimals(laborTotal),
    subtotal: roundToTwoDecimals(subtotal),
    markupAmount: roundToTwoDecimals(markupAmount),
    gst: roundToTwoDecimals(gst),
    total: roundToTwoDecimals(total),
  };
}

/**
 * Update a quote with new calculations
 * @param quote - The quote to update
 */
export function updateQuoteCalculations(quote: Quote): Quote {
  const calculation = calculateQuote(
    quote.materials,
    quote.laborRate,
    quote.laborHours,
    quote.markup
  );

  return {
    ...quote,
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
