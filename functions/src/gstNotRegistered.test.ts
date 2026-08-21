/**
 * Server-side money paths for the "not registered for GST" mode
 * (gstRegistered === false; undefined must keep behaving as registered).
 */
import { describe, it, expect } from 'vitest';
import { buildXeroLineItems } from './xeroSync';
import { renderPricingRows } from './email';

// A doc whose customer-facing PDF collapses to a single total line, so
// buildXeroLineItems emits exactly one summary line item.
function summaryOnlyDoc(over: Record<string, any> = {}): Record<string, any> {
  return {
    job: { name: 'Fence repair' },
    showMaterialCosts: false,
    showLaborCosts: false,
    total: 1100,
    ...over,
  };
}

describe('buildXeroLineItems — GST registration', () => {
  it('registered exclusive (legacy default): strips the 10% Xero re-adds, OUTPUT tax', () => {
    const items = buildXeroLineItems(summaryOnlyDoc());
    expect(items).toHaveLength(1);
    expect(items[0].UnitAmount).toBe(1000); // 1100 / 1.1
    expect(items[0].TaxType).toBe('OUTPUT');
  });

  it('registered inclusive: sends the inc-GST total as-is, OUTPUT tax', () => {
    const items = buildXeroLineItems(summaryOnlyDoc({ pricesIncludeGst: true }));
    expect(items[0].UnitAmount).toBe(1100);
    expect(items[0].TaxType).toBe('OUTPUT');
  });

  it('not registered: total sent as-is (no ÷1.1) and BAS Excluded tax type', () => {
    const items = buildXeroLineItems(summaryOnlyDoc({ gstRegistered: false, total: 1000 }));
    expect(items[0].UnitAmount).toBe(1000);
    expect(items[0].TaxType).toBe('BASEXCLUDED');
  });

  it('not registered: every itemised line is BAS Excluded', () => {
    const items = buildXeroLineItems({
      gstRegistered: false,
      job: { name: 'Deck' },
      materials: [{ name: 'Board', quantity: 10, price: 12 }],
      sections: [{ name: 'Build', laborHours: 4, multiplier: 1, laborRate: 100, laborTotal: 400 }],
      markupAmount: 50,
      total: 570,
    });
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.every((i: any) => i.TaxType === 'BASEXCLUDED')).toBe(true);
  });
});

describe('renderPricingRows — GST registration', () => {
  const base = {
    materialsSubtotal: 100,
    laborTotal: 200,
    subtotal: 300,
    gst: 30,
    total: 330,
    accent: '#111827',
  };

  it('registered (undefined flag): GST row and "Total (inc GST)" label', () => {
    const html = renderPricingRows(base);
    expect(html).toContain('GST');
    expect(html).toContain('$30.00');
    expect(html).toContain('Total (inc GST)');
    expect(html).not.toContain('No GST has been charged.');
  });

  it('not registered: no GST row, plain "Total" label, and the no-GST note', () => {
    const html = renderPricingRows({ ...base, gstRegistered: false, gst: 0, total: 300 });
    expect(html).not.toContain('>GST<');
    expect(html).not.toContain('Total (inc GST)');
    expect(html).toMatch(/>Total</);
    expect(html).toContain('No GST has been charged.');
    expect(html).toContain('$300.00');
  });

  it('deposit credit still wins the label in both modes (Balance Due)', () => {
    const registered = renderPricingRows({ ...base, depositCredit: 100 });
    const notRegistered = renderPricingRows({ ...base, gstRegistered: false, gst: 0, total: 300, depositCredit: 100 });
    expect(registered).toContain('Balance Due');
    expect(notRegistered).toContain('Balance Due');
    expect(notRegistered).toContain('No GST has been charged.');
  });

  it('inclusive prices: GST leaves the addition stack and becomes a note under the total', () => {
    // Subtotal already includes GST, so a GST row in the stack invited the
    // reader to sum Subtotal + GST and overshoot — the email showed numbers
    // that visibly didn't add up. Same treatment as the PDF and the
    // acceptance page.
    const html = renderPricingRows({ ...base, pricesIncludeGst: true, subtotal: 330 });
    expect(html).not.toContain('>GST<');
    expect(html).toContain('Total includes GST of $30.00');
    expect(html).toContain('Total (inc GST)');
    // The disclosure sits below the total, not above it.
    expect(html.indexOf('Total includes GST of')).toBeGreaterThan(html.indexOf('Total (inc GST)'));
  });
});
