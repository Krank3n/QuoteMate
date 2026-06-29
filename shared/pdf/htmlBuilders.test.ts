import { buildQuotePdfHtml } from './htmlBuilders';
import type { QuotePdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = {
  businessName: 'Test Co',
};

// Minimal quote fixture matching the real QuotePdfData shape. Materials carry a
// price/total so we can assert prices are stripped under itemsOnly. One labour
// section so the labour table renders a cost column under 'full'.
function makeQuote(overrides: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'Test Client',
    quoteNumber: 'Q-001',
    quoteDate: '1 Jan 2025',
    job: { name: 'Test Job', description: 'A job' },
    materials: [
      { name: 'Widget A', quantity: 2, unit: 'each', price: 50, totalPrice: 100 },
    ],
    materialsSubtotal: 100,
    laborTotal: 200,
    sections: [
      {
        name: 'Install',
        laborHours: 2,
        laborRate: 100,
        laborTotal: 200,
      },
    ],
    subtotal: 300,
    markup: 0,
    markupAmount: 0,
    gst: 30,
    total: 330,
    pricesIncludeGst: false,
    showMarkup: true,
    ...overrides,
  };
}

describe('buildQuotePdfHtml — tri-state materials/labour display', () => {
  it('materialsDisplay=itemsOnly: keeps item name, drops prices and subtotal', () => {
    const html = buildQuotePdfHtml(
      makeQuote({ materialsDisplay: 'itemsOnly', laborDisplay: 'hidden' }),
      business,
    );
    expect(html).toContain('Widget A');
    // The materials table header drops Unit Price / Total columns.
    expect(html).not.toContain('Unit Price');
    // No per-line material price and no Materials Subtotal footer row.
    expect(html).not.toContain('$50.00');
    expect(html).not.toContain('Materials Subtotal');
  });

  it('laborDisplay=itemsOnly: keeps the labour description, drops cost column and Labour Total', () => {
    const html = buildQuotePdfHtml(
      makeQuote({ materialsDisplay: 'hidden', laborDisplay: 'itemsOnly' }),
      business,
    );
    expect(html).toContain('Install');
    expect(html).not.toContain('Labour Total');
    // The labour section's $200 amount must not leak.
    expect(html).not.toContain('$200.00');
  });

  it('both itemsOnly: Subtotal, GST and Grand Total all present and ordered', () => {
    const html = buildQuotePdfHtml(
      makeQuote({ materialsDisplay: 'itemsOnly', laborDisplay: 'itemsOnly' }),
      business,
    );
    const iSubtotal = html.indexOf('Subtotal (ex GST)');
    const iGst = html.indexOf('GST (10%)');
    const iTotal = html.indexOf('TOTAL');
    expect(iSubtotal).toBeGreaterThan(-1);
    expect(iGst).toBeGreaterThan(-1);
    expect(iTotal).toBeGreaterThan(-1);
    expect(iSubtotal).toBeLessThan(iGst);
    expect(iGst).toBeLessThan(iTotal);
    // Subtotal still reconciles to materials + labour.
    expect(html).toContain('$300.00');
  });

  it('both hidden: totals block still present and ordered', () => {
    const html = buildQuotePdfHtml(
      makeQuote({ materialsDisplay: 'hidden', laborDisplay: 'hidden' }),
      business,
    );
    const iSubtotal = html.indexOf('Subtotal (ex GST)');
    const iGst = html.indexOf('GST (10%)');
    const iTotal = html.indexOf('TOTAL');
    expect(iSubtotal).toBeGreaterThan(-1);
    expect(iSubtotal).toBeLessThan(iGst);
    expect(iGst).toBeLessThan(iTotal);
    // Materials/labour sections are dropped entirely.
    expect(html).not.toContain('Widget A');
    expect(html).not.toContain('Install');
  });

  it('pricesIncludeGst=true with both itemsOnly: Subtotal row still present and amounts reconcile', () => {
    const html = buildQuotePdfHtml(
      makeQuote({
        materialsDisplay: 'itemsOnly',
        laborDisplay: 'itemsOnly',
        pricesIncludeGst: true,
      }),
      business,
    );
    // Inclusive mode relabels the rows but Subtotal still renders.
    expect(html).toContain('>Subtotal<');
    expect(html).toContain('Includes GST');
    expect(html).toContain('$300.00');
    expect(html).toContain('$330.00');
  });

  it('backward-compat: showMaterialCosts=false (no materialsDisplay) hides the materials section', () => {
    const html = buildQuotePdfHtml(
      makeQuote({ showMaterialCosts: false }),
      business,
    );
    expect(html).not.toContain('Widget A');
    // Materials Subtotal row in the summary is dropped, but Subtotal stays.
    expect(html).not.toContain('Materials Subtotal');
    expect(html).toContain('Subtotal (ex GST)');
  });

  it('backward-compat: showMaterialCosts=true renders the materials section with prices', () => {
    const html = buildQuotePdfHtml(
      makeQuote({ showMaterialCosts: true }),
      business,
    );
    expect(html).toContain('Widget A');
    expect(html).toContain('Unit Price');
    expect(html).toContain('$50.00');
    expect(html).toContain('Materials Subtotal');
  });

  it('showMarkup=false with itemsOnly: no pre-markup leak, prices still stripped', () => {
    const html = buildQuotePdfHtml(
      makeQuote({
        materialsDisplay: 'itemsOnly',
        laborDisplay: 'itemsOnly',
        showMarkup: false,
        markup: 20,
        markupAmount: 20,
      }),
      business,
    );
    expect(html).toContain('Widget A');
    // No price columns/values leak in item rows even with markup rolled in.
    expect(html).not.toContain('Unit Price');
    expect(html).not.toContain('$50.00');
    expect(html).not.toContain('$60.00');
    // Markup line is never broken out in itemsOnly material rows.
    expect(html).not.toContain('Materials Subtotal');
  });
});
