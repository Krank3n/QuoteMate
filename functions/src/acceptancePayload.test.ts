/**
 * The acceptance page must not show a customer anything their PDF hid. The
 * projection used to live inline in a 60-line res.json() with its own copy of
 * the inheritance rule — which is exactly how the two drifted.
 */
import { describe, it, expect } from 'vitest';
import { buildAcceptanceQuotePayload } from './acceptancePayload';

const display = {
  materials: [
    { name: 'Skip bin', quantity: 1, unit: 'each', price: 300, totalPrice: 300 },
    { name: 'Low sheen 10L', quantity: 2, unit: 'each', price: 100, totalPrice: 200 },
  ],
  materialsSubtotal: 500,
  laborTotal: 1190,
  subtotal: 1690,
  markupAmount: 0,
};

function quote(over: Record<string, any> = {}) {
  return {
    id: 'q1',
    quoteNumber: 'Q-001',
    customerName: 'A Customer',
    job: { name: 'Repaint', description: 'Strip and repaint' },
    gst: 169,
    total: 1859,
    ...over,
  };
}

describe('buildAcceptanceQuotePayload', () => {
  it('itemises by default', () => {
    const p = buildAcceptanceQuotePayload(quote(), {}, display);
    expect(p.priceDetail).toBe('itemised');
    expect(p.materials).toHaveLength(2);
    expect(p.subtotal).toBe(1690);
  });

  it('keeps the line names but drops the money in summary', () => {
    const p = buildAcceptanceQuotePayload(quote({ priceDetail: 'summary' }), {}, display);
    expect(p.priceDetail).toBe('summary');
    // The names still ship — the page decides not to print the figures beside
    // them. The section totals it needs are the subtotals below.
    expect(p.materials.map((m: any) => m.name)).toEqual(['Skip bin', 'Low sheen 10L']);
    expect(p.subtotal).toBe(1690);
  });

  it('ships no line items at all in total mode', () => {
    const p = buildAcceptanceQuotePayload(quote({ priceDetail: 'total' }), {}, display);
    expect(p.materials).toBeUndefined();
    expect(p.subtotal).toBeUndefined();
    expect(p.materialsSubtotal).toBeUndefined();
    // The total and its GST disclosure always ship.
    expect(p.total).toBe(1859);
    expect(p.gst).toBe(169);
  });

  it('inherits the business default when the document says nothing', () => {
    const p = buildAcceptanceQuotePayload(quote(), { defaultPriceDetail: 'total' }, display);
    expect(p.priceDetail).toBe('total');
    expect(p.materials).toBeUndefined();
  });

  it('migrates the legacy flag pair', () => {
    const p = buildAcceptanceQuotePayload(
      quote({ showMaterialCosts: false, showLaborCosts: false }),
      {},
      display,
    );
    expect(p.priceDetail).toBe('total');
  });

  it('carries kind and scope so a work item renders as a scope row', () => {
    const p = buildAcceptanceQuotePayload(quote(), {}, {
      ...display,
      materials: [
        { name: 'INTERIOR', quantity: 1, unit: 'each', totalPrice: 22750, kind: 'work', scope: 'Full interior.' },
      ],
    });
    expect(p.materials[0]).toMatchObject({ kind: 'work', scope: 'Full interior.', totalPrice: 22750 });
  });

  it('keeps the legacy flags on the payload for one release', () => {
    // A cached copy of the page reads these directly; dropping them now would
    // blank the breakdown for anyone holding an old tab open.
    const p = buildAcceptanceQuotePayload(quote({ priceDetail: 'summary' }), {}, display);
    expect(p).toHaveProperty('showMaterialCosts');
    expect(p).toHaveProperty('showLaborCosts');
    expect(p.showSubtotal).toBe(true);
  });

  it('never leaks live terms — only the send-time snapshot', () => {
    expect(buildAcceptanceQuotePayload(quote(), {}, display).terms).toBeNull();
    expect(
      buildAcceptanceQuotePayload(quote({ termsSnapshot: 'As sent.' }), {}, display).terms,
    ).toBe('As sent.');
  });
});
