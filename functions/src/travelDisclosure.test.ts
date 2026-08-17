/**
 * Disclosing the travel surcharge in the emailed summary.
 *
 * The email rendered Materials / Labour / Subtotal / GST / Total and nothing
 * else, so a travel surcharge was charged inside the total without a line
 * naming it. A real quote went out reading Subtotal $6,021.85 above Total
 * $6,406.73, with $384.88 of that unexplained — while the PDF attached to the
 * very same email did disclose it. Two customer-facing artifacts of one
 * document, disagreeing.
 *
 * The row is gated and positioned to match the PDF exactly
 * (shared/pdf/htmlBuilders.ts): shown wherever Subtotal is shown, sitting
 * between Subtotal and GST.
 */
import { describe, it, expect } from 'vitest';
import { renderPricingRows } from './email';

const base = {
  materialsSubtotal: 3141.85,
  laborTotal: 2880,
  subtotal: 6021.85,
  gst: 582.43,
  total: 6406.73,
  accent: '#111827',
  travelAdjustment: 7,
  travelAdjustmentAmount: 384.87,
};

/** Strip tags so row order can be asserted on plain text. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('renderPricingRows — travel surcharge disclosure', () => {
  describe('the charge is named', () => {
    it('renders the surcharge with its percentage and amount', () => {
      const html = renderPricingRows(base);
      expect(html).toContain('Travel adjustment (7%)');
      expect(html).toContain('$384.87');
    });

    it('closes the gap between Subtotal and Total', () => {
      const html = renderPricingRows(base);
      // Subtotal + travel = the pre-GST figure behind the total (GST inclusive).
      expect(html).toContain('$6,021.85');
      expect(html).toContain('$384.87');
      expect(html).toContain('$6,406.73');
    });

    it('sits between Subtotal and GST, as it does on the PDF', () => {
      const t = text(renderPricingRows(base));
      expect(t.indexOf('Subtotal')).toBeLessThan(t.indexOf('Travel adjustment'));
      expect(t.indexOf('Travel adjustment')).toBeLessThan(t.indexOf('GST'));
    });
  });

  describe('follows the same disclosure gate as Subtotal', () => {
    it('shows in itemised', () => {
      expect(renderPricingRows({ ...base, priceDetail: 'itemised' })).toContain('Travel adjustment');
    });

    it('shows in scope-only, where Subtotal and Total are both visible', () => {
      const html = renderPricingRows({ ...base, priceDetail: 'summary' });
      expect(html).toContain('Subtotal');
      expect(html).toContain('Travel adjustment');
    });

    it('is hidden in total-only, where there is no column to reconcile', () => {
      const html = renderPricingRows({ ...base, priceDetail: 'total' });
      expect(html).not.toContain('Subtotal');
      expect(html).not.toContain('Travel adjustment');
    });
  });

  describe('renders nothing when there is no surcharge', () => {
    it('no percentage set', () => {
      const html = renderPricingRows({ ...base, travelAdjustment: undefined, travelAdjustmentAmount: undefined });
      expect(html).not.toContain('Travel adjustment');
    });

    it('a zero amount', () => {
      const html = renderPricingRows({ ...base, travelAdjustment: 7, travelAdjustmentAmount: 0 });
      expect(html).not.toContain('Travel adjustment');
    });

    it('leaves the rest of the summary untouched', () => {
      const html = renderPricingRows({ ...base, travelAdjustment: 0, travelAdjustmentAmount: 0 });
      expect(html).toContain('Materials');
      expect(html).toContain('Labour');
      expect(html).toContain('Subtotal');
      expect(html).toContain('GST');
    });
  });

  describe('the non-GST-registered total-only card still collapses cleanly', () => {
    it('renders no Summary header when travel is the only thing hidden', () => {
      const html = renderPricingRows({
        ...base,
        priceDetail: 'total',
        gstRegistered: false,
        gst: 0,
      });
      expect(html).not.toContain('Summary');
      expect(html).not.toContain('Travel adjustment');
    });
  });
});
