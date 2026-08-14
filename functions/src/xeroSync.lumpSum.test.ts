/**
 * A lump-sum section in Xero.
 *
 * The generic section path derives Quantity from hours (or from
 * laborTotal / laborRate) and UnitAmount from the rate. A lump-sum section has
 * rate 0 by invariant, so that path would either divide by zero or hit the
 * `rate <= 0 → continue` guard and drop the money out of the invoice
 * altogether — the tradie's Xero total would silently disagree with the PDF
 * the customer signed.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({ firestore: () => ({}) }));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import { buildXeroLineItems } from './xeroSync';

const HOURLY = 85;

function lumpSum(name: string, laborTotal: number) {
  return {
    id: name, name, multiplier: 1,
    laborHours: 0, laborHoursTotal: 0, laborRate: 0, laborUnit: 'hours',
    laborTotal, sortOrder: 0, pricing: 'lumpSum',
  };
}

describe('buildXeroLineItems — lump-sum sections', () => {
  it('sends a lump-sum section as one line at quantity 1', () => {
    const lines = buildXeroLineItems({
      job: { name: 'Bathroom' },
      materials: [],
      sections: [lumpSum('Bathroom regrout', 1200)],
      laborTotal: 1200,
      subtotal: 1200,
      markupAmount: 0,
      gst: 120,
      total: 1320,
    });

    expect(lines).toEqual([
      {
        Description: 'Bathroom regrout',
        Quantity: 1,
        UnitAmount: 1200,
        AccountCode: '200',
        TaxType: 'OUTPUT',
      },
    ]);
  });

  it('sums to the quote total alongside materials and hourly labour', () => {
    const doc = {
      job: { name: 'Reno' },
      materials: [{ name: 'Tile adhesive', quantity: 4, unit: 'each', price: 50, totalPrice: 200 }],
      sections: [
        {
          id: 'strip', name: 'Strip out', multiplier: 1,
          laborHours: 4, laborHoursTotal: 4, laborRate: HOURLY, laborUnit: 'hours',
          laborTotal: 340, sortOrder: 0, pricing: 'hourly',
        },
        lumpSum('Bathroom regrout', 1200),
      ],
      laborExtraHours: 0,
      laborRate: HOURLY,
      materialsSubtotal: 200,
      laborTotal: 1540,
      subtotal: 1740,
      markupAmount: 0,
      gst: 174,
      total: 1914,
    };

    const lines = buildXeroLineItems(doc);
    const sum = lines.reduce((t, l) => t + l.Quantity * l.UnitAmount, 0);
    // Ex-GST total: every dollar the customer signed for reaches Xero exactly
    // once, with none of it lost to the zero-rate guard.
    expect(Math.round(sum * 100) / 100).toBe(1740);
    expect(lines.find((l) => l.Description === 'Bathroom regrout')).toEqual({
      Description: 'Bathroom regrout',
      Quantity: 1,
      UnitAmount: 1200,
      AccountCode: '200',
      TaxType: 'OUTPUT',
    });
  });

  it('skips a $0 lump-sum section rather than emitting a zero line', () => {
    const lines = buildXeroLineItems({
      job: { name: 'Bathroom' },
      materials: [{ name: 'Grout', quantity: 1, unit: 'each', price: 40, totalPrice: 40 }],
      sections: [lumpSum('Included prep', 0)],
      laborTotal: 0,
      subtotal: 40,
      markupAmount: 0,
      gst: 4,
      total: 44,
    });
    expect(lines.map((l) => l.Description)).toEqual(['Grout']);
  });
});
