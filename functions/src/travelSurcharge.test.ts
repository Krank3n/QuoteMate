/**
 * The travel surcharge that was charged but never named.
 *
 * A real quote emailed to a customer on 17 Aug 2026 read:
 *
 *   Materials        $3,141.85
 *   Labour           $2,880.00
 *   Subtotal         $6,021.85
 *   GST                $582.43   (included, not added)
 *   Total (inc GST)  $6,406.73
 *
 * $384.88 of that total was a 7% travel surcharge with no line naming it. The
 * customer could not reconcile the column, and the PDF attached to the same
 * email did disclose it — so the two artifacts disagreed.
 *
 * The arithmetic below is the part that is easy to get wrong: the surcharge is
 * a percentage of the RAW subtotal (materials + labour, pre-markup), while the
 * email is handed a markup-inflated "Subtotal" so its visible lines still add
 * up. Taking the percentage of the inflated figure gives $421.53, not the
 * $384.87 actually charged.
 */
import { describe, it, expect } from 'vitest';
import { travelAdjustmentAmountFor } from './travelSurcharge';

describe('travelAdjustmentAmountFor', () => {
  describe('the QU-178692 surcharge', () => {
    it('computes the amount the customer was actually charged', () => {
      // Raw subtotal 5498.21 = materials 2618.21 + labour 2880.00.
      expect(travelAdjustmentAmountFor({ travelAdjustment: 7, subtotal: 5498.21 })).toBe(384.87);
    });

    it('does NOT take the percentage of the markup-inflated subtotal', () => {
      // 6021.85 is what the email displays as "Subtotal" once markup is folded
      // into materials. Using it would overstate the surcharge by ~$37.
      expect(travelAdjustmentAmountFor({ travelAdjustment: 7, subtotal: 6021.85 })).not.toBe(384.87);
      expect(travelAdjustmentAmountFor({ travelAdjustment: 7, subtotal: 5498.21 })).toBeLessThan(
        travelAdjustmentAmountFor({ travelAdjustment: 7, subtotal: 6021.85 }),
      );
    });

    it('matches the PDF, which multiplies the same stored subtotal', () => {
      const subtotal = 5498.21;
      const pdf = subtotal * (7 / 100); // shared/pdf/htmlBuilders.ts
      expect(travelAdjustmentAmountFor({ travelAdjustment: 7, subtotal })).toBeCloseTo(pdf, 2);
    });
  });

  describe('rounding', () => {
    it('rounds to cents rather than emitting a long float', () => {
      // 1234.56 * 3% = 37.0368
      expect(travelAdjustmentAmountFor({ travelAdjustment: 3, subtotal: 1234.56 })).toBe(37.04);
    });
  });

  describe('returns zero when there is nothing to charge', () => {
    it('no travel percentage set', () => {
      expect(travelAdjustmentAmountFor({ subtotal: 5000 })).toBe(0);
      expect(travelAdjustmentAmountFor({ travelAdjustment: 0, subtotal: 5000 })).toBe(0);
    });

    it('a dismissed (negative) percentage never becomes a credit', () => {
      expect(travelAdjustmentAmountFor({ travelAdjustment: -5, subtotal: 5000 })).toBe(0);
    });

    it('no subtotal to charge against', () => {
      expect(travelAdjustmentAmountFor({ travelAdjustment: 7 })).toBe(0);
      expect(travelAdjustmentAmountFor({ travelAdjustment: 7, subtotal: 0 })).toBe(0);
    });

    it('a missing document', () => {
      expect(travelAdjustmentAmountFor(null)).toBe(0);
      expect(travelAdjustmentAmountFor(undefined)).toBe(0);
    });
  });

  describe('older records with no stored subtotal', () => {
    it('falls back to materials + labour', () => {
      expect(
        travelAdjustmentAmountFor({ travelAdjustment: 7, materialsSubtotal: 2618.21, laborTotal: 2880 }),
      ).toBe(384.87);
    });

    it('prefers the stored subtotal when both are present', () => {
      expect(
        travelAdjustmentAmountFor({
          travelAdjustment: 10,
          subtotal: 1000,
          materialsSubtotal: 9999,
          laborTotal: 9999,
        }),
      ).toBe(100);
    });
  });
});
