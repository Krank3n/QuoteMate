/**
 * "What the customer sees" — three modes, one document.
 *
 * The invariants that matter are arithmetic, not cosmetic: whatever the tradie
 * chooses to hide, the numbers that remain must still add up, and the grand
 * total must be the same in all three. GST is disclosed in every mode — it is
 * a legal disclosure, not a preference.
 */

import { describe, it, expect } from 'vitest';
import { buildQuotePdfHtml } from './htmlBuilders';
import type { QuotePdfData, BusinessPdfData, PriceDetail } from './types';

const business: BusinessPdfData = { businessName: 'Test Trades', logoHtml: '' };

/**
 * $500 of materials in two sections plus $1,190 of labour in the same two
 * sections. Subtotal $1,690, GST $169, total $1,859.
 */
function quoteData(over: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'A Customer',
    quoteDate: '10 July 2026',
    job: { name: 'Repaint', description: 'Strip and repaint' },
    materials: [
      { name: 'Skip bin', quantity: 1, unit: 'each', price: 180, totalPrice: 180, section: 'Demolition' },
      { name: 'Drop sheets', quantity: 4, unit: 'each', price: 30, totalPrice: 120, section: 'Demolition' },
      { name: 'Low sheen 10L', quantity: 2, unit: 'each', price: 55, totalPrice: 110, section: 'Painting' },
      { name: 'Sugar soap', quantity: 3, unit: 'each', price: 30, totalPrice: 90, section: 'Painting' },
    ],
    materialsSubtotal: 500,
    laborTotal: 1190,
    laborRate: 85,
    sections: [
      { name: 'Demolition', laborHours: 4, multiplier: 1, laborHoursTotal: 4, laborRate: 85, laborUnit: 'hours', laborTotal: 340 },
      { name: 'Painting', laborHours: 10, multiplier: 1, laborHoursTotal: 10, laborRate: 85, laborUnit: 'hours', laborTotal: 850 },
    ],
    subtotal: 1690,
    markup: 0,
    markupAmount: 0,
    gst: 169,
    total: 1859,
    showLaborHours: true,
    ...over,
  };
}

function render(detail: PriceDetail, over: Partial<QuotePdfData> = {}): string {
  return buildQuotePdfHtml(quoteData({ priceDetail: detail, ...over }), business);
}

/** Every dollar figure on the page, in order. */
function money(html: string): string[] {
  return html.match(/\$[\d,]+\.\d{2}/g) || [];
}

describe('priceDetail — summary ("Scope only")', () => {
  it('keeps every item name and shows no per-line money', () => {
    const html = render('summary');
    for (const name of ['Skip bin', 'Drop sheets', 'Low sheen 10L', 'Sugar soap']) {
      expect(html).toContain(name);
    }
    // No quantities, no unit prices, no per-line totals.
    for (const qty of ['1 each', '4 each', '2 each', '3 each']) {
      expect(html).not.toContain(qty);
    }
    for (const perLine of ['$180.00', '$120.00', '$110.00', '$90.00', '$55.00', '$30.00']) {
      expect(html).not.toContain(perLine);
    }
    // …and no hourly rate detail either — a unit price by another name.
    expect(html).not.toContain('@ $85.00/hr');
  });

  it('reconciles: the visible section totals sum to the Subtotal', () => {
    const html = render('summary');
    // Materials: Demolition $300, Painting $200. Labour: $340 and $850.
    // 300 + 200 + 340 + 850 = 1690 = the Subtotal.
    for (const sectionTotal of ['$300.00', '$200.00', '$340.00', '$850.00']) {
      expect(html).toContain(sectionTotal);
    }
    expect(html).toContain('$1,690.00');
  });

  it('drops the Materials/Labour split but keeps the Subtotal', () => {
    const html = render('summary');
    expect(html).not.toContain('<span>Materials Subtotal</span>');
    expect(html).not.toContain('<span>Labour</span>');
    expect(html).toContain('<span>Subtotal (ex GST)</span>');
    expect(html).toContain('$1,690.00');
  });
});

describe('priceDetail — total ("Total only")', () => {
  it('shows the total and nothing that could reconstruct it', () => {
    const html = render('total');
    expect(html).not.toContain('Skip bin');
    expect(html).not.toContain('Low sheen 10L');
    expect(html).not.toContain('<span>Subtotal (ex GST)</span>');
    expect(html).not.toContain('<span>Materials Subtotal</span>');
    expect(html).toContain('<span>TOTAL</span>');
    expect(html).toContain('$1,859.00');
  });
});

describe('priceDetail — invariants across all three modes', () => {
  it('renders the same grand total in every mode', () => {
    for (const detail of ['itemised', 'summary', 'total'] as const) {
      const html = render(detail);
      // The last figure on the page is the grand total.
      expect(money(html).at(-1)).toBe('$1,859.00');
    }
  });

  it('discloses GST in every mode', () => {
    for (const detail of ['itemised', 'summary', 'total'] as const) {
      const html = render(detail);
      expect(html).toContain('<span>GST (10%)</span>');
      expect(html).toContain('$169.00');
    }
  });

  it('carries the not-registered note in every mode', () => {
    for (const detail of ['itemised', 'summary', 'total'] as const) {
      const html = render(detail, { gstRegistered: false, gst: 0, total: 1690 });
      expect(html).toContain('No GST has been charged');
      expect(html).not.toContain('<span>GST (10%)</span>');
    }
  });

  it('never breaks markup out once per-line money is hidden', () => {
    // showMarkup: true asks for a Markup row. In 'itemised' it appears; in the
    // other two there is nothing for it to reconcile against, so it rolls into
    // the visible figures instead of leaving a page that doesn't add up.
    const withMarkup = { markup: 10, laborMarkup: 10, markupAmount: 169, showMarkup: true };
    expect(render('itemised', withMarkup)).toContain('<span>Markup</span>');
    expect(render('summary', withMarkup)).not.toContain('<span>Markup</span>');
    expect(render('total', withMarkup)).not.toContain('<span>Markup</span>');
  });

  it('shows the travel row exactly when the Subtotal shows', () => {
    const travel = { travelAdjustment: 3 };
    expect(render('itemised', travel)).toContain('Travel Adjustment (3%)');
    expect(render('summary', travel)).toContain('Travel Adjustment (3%)');
    expect(render('total', travel)).not.toContain('Travel Adjustment');
  });

  it('migrates the legacy flag pair when priceDetail is absent', () => {
    const html = buildQuotePdfHtml(
      quoteData({ showMaterialCosts: false, showLaborCosts: false }),
      business,
    );
    // Both flags false has always meant "grand total only".
    expect(html).not.toContain('Skip bin');
    expect(html).toContain('$1,859.00');
  });
});

describe('payment schedule', () => {
  it('renders when a deposit is set', () => {
    const html = render('itemised', {
      requireDeposit: true,
      depositPercentage: 10,
      depositAmount: 185.9,
    });
    expect(html).toContain('Payment Schedule');
    expect(html).toContain('Deposit (10%)');
    expect(html).toContain('before commencement of any work');
    expect(html).toContain('$185.90');
    // Balance on completion = total − deposit.
    expect(html).toContain('$1,673.10');
  });

  it('is absent when no deposit is required', () => {
    expect(render('itemised')).not.toContain('Payment Schedule');
    // …and absent when the flag is on but the amount never got set.
    expect(render('itemised', { requireDeposit: true, depositAmount: 0 }))
      .not.toContain('Payment Schedule');
  });
});
