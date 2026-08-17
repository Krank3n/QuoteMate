/**
 * The travel surcharge in dollars.
 *
 * `travelAdjustment` is stored as a PERCENTAGE (7 = +7%), and the charge is a
 * percentage of the RAW subtotal — materials + labour before markup. That is
 * how documentCalculator builds the total, and how the PDF renders its Travel
 * Adjustment row (shared/pdf/htmlBuilders.ts passes `quote.subtotal`, the
 * stored raw figure).
 *
 * It matters which subtotal, because the email is handed a DIFFERENT one: when
 * the tradie hides markup, applyHideMarkupForDisplay folds it into materials so
 * the visible lines still add up, producing a larger "Subtotal". Taking the
 * percentage of that would overstate the surcharge — on the quote that exposed
 * this, $421.53 instead of the $384.87 actually charged.
 *
 * Lives in its own module so it can be tested without importing
 * documentHandlers, and so both the quote and invoice email paths compute it
 * the one way.
 */

export interface TravelSurchargeInput {
  /** Percentage, e.g. 7 for +7%. */
  travelAdjustment?: number;
  /** Raw stored subtotal (materials + labour, pre-markup). */
  subtotal?: number;
  /** Fallbacks when `subtotal` is absent on an older record. */
  materialsSubtotal?: number;
  laborTotal?: number;
}

export function travelAdjustmentAmountFor(doc: TravelSurchargeInput | null | undefined): number {
  const percent = Number(doc?.travelAdjustment) || 0;
  if (percent <= 0) return 0;
  const stored = Number(doc?.subtotal) || 0;
  const base =
    stored > 0
      ? stored
      : (Number(doc?.materialsSubtotal) || 0) + (Number(doc?.laborTotal) || 0);
  if (base <= 0) return 0;
  return Math.round(base * (percent / 100) * 100) / 100;
}
