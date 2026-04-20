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

import { Material, QuoteSection } from '../types';
import type { Document } from '../types/document';

/** Round a number to 2 decimal places. */
export function roundToTwoDecimals(num: number): number {
  return Math.round(num * 100) / 100;
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
  const materialMarkupAmount = materialsSubtotal * (markupPercent / 100);
  const laborMarkupAmount = laborTotal * (laborMarkupPercent / 100);
  const markupAmount = materialMarkupAmount + laborMarkupAmount;
  const travelAdjustmentAmount = subtotal * (travelAdjustment / 100);
  const subtotalWithMarkup = subtotal + markupAmount + travelAdjustmentAmount;
  const gst = subtotalWithMarkup * 0.1;
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
  );
  return {
    ...doc,
    materialsSubtotal: calc.materialsSubtotal,
    laborTotal: calc.laborTotal,
    subtotal: calc.subtotal,
    markupAmount: calc.markupAmount,
    gst: calc.gst,
    total: calc.total,
    updatedAt: Date.now(),
  };
}
