/**
 * The customer-facing labour block. Canonical hours in, chosen unit out — and
 * the dollars must be identical either way, including for legacy day-shaped
 * records written before the canonical-hours migration.
 */

import { describe, it, expect } from 'vitest';
import { buildQuotePdfHtml } from './htmlBuilders';
import type { QuotePdfData, BusinessPdfData, LaborSection } from './types';

const business: BusinessPdfData = {
  businessName: 'Test Trades',
  email: 'test@example.com',
  phone: '0400 000 000',
  abn: '12 345 678 901',
  logoHtml: '',
};

function quoteData(over: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'Leo Customer',
    quoteDate: '10 July 2026',
    job: { name: 'Fence', description: 'New fence' },
    materials: [{ name: 'Palings', quantity: 1, unit: 'each', price: 100, totalPrice: 100 }],
    materialsSubtotal: 100,
    laborTotal: 2720,
    subtotal: 2820,
    markup: 0,
    markupAmount: 0,
    gst: 282,
    total: 3102,
    showLaborHours: true,
    ...over,
  };
}

/** 32h of work at $85/h = $2,720, stored canonically. */
const canonicalSections: LaborSection[] = [
  { name: 'Fence Bays', laborHours: 2, multiplier: 15, laborHoursTotal: 30, laborRate: 85, laborUnit: 'hours', laborTotal: 2550 },
  { name: 'End Post', laborHours: 2, multiplier: 1, laborHoursTotal: 2, laborRate: 85, laborUnit: 'hours', laborTotal: 170 },
];

/** The same job as an older build stored it: days and a day rate. */
const legacyDaySections: LaborSection[] = [
  { name: 'Fence Bays', laborHours: 0.25, multiplier: 15, laborHoursTotal: 3.75, laborRate: 680, laborUnit: 'days', laborTotal: 2550 },
  { name: 'End Post', laborHours: 0.25, multiplier: 1, laborHoursTotal: 0.25, laborRate: 680, laborUnit: 'days', laborTotal: 170 },
];

/** Every dollar figure the customer can read off the page. */
function money(html: string): string[] {
  return (html.match(/\$[\d,]+\.\d{2}/g) || []);
}

/** The amounts only — per-unit rates stripped, since those change with the unit. */
function amounts(html: string): string[] {
  return money(html.replace(/@ \$[\d,]+\.\d{2}\/(?:hr|day)/g, ''));
}

describe('PDF labour block', () => {
  it('renders canonical hours as hours by default', () => {
    const html = buildQuotePdfHtml(quoteData({ sections: canonicalSections }), business);
    expect(html).toContain('30 hours @ $85.00/hr');
    expect(html).toContain('2 hours @ $85.00/hr');
    expect(html).not.toContain('/day');
  });

  it('renders the same labour as days when the tradie prefers days', () => {
    const html = buildQuotePdfHtml(
      quoteData({ sections: canonicalSections, labourDisplayUnit: 'days' }),
      business,
    );
    expect(html).toContain('3.75 days @ $680.00/day');
    expect(html).toContain('0.25 days @ $680.00/day');
    expect(html).not.toContain('/hr');
  });

  it('prices a legacy day-shaped record identically to its canonical twin', () => {
    const canonical = buildQuotePdfHtml(quoteData({ sections: canonicalSections }), business);
    const legacy = buildQuotePdfHtml(quoteData({ sections: legacyDaySections }), business);
    // Every amount on the page is identical — line totals, subtotal, GST, total.
    expect(amounts(legacy)).toEqual(amounts(canonical));
    // The two differ only in how the rate is expressed: the legacy record was
    // authored in days, so it keeps showing days at the equivalent day rate.
    expect(legacy).toContain('3.75 days @ $680.00/day');
    expect(canonical).toContain('30 hours @ $85.00/hr');
  });

  it('never re-multiplies a day rate that is already a day rate', () => {
    const html = buildQuotePdfHtml(
      quoteData({ sections: legacyDaySections, labourDisplayUnit: 'days' }),
      business,
    );
    expect(html).toContain('$680.00/day');
    expect(html).not.toContain('$5,440.00');
    expect(html).not.toContain('$5440.00');
  });

  it('shows the extra-labour row in the display unit at the matching rate', () => {
    const html = buildQuotePdfHtml(
      quoteData({
        sections: canonicalSections,
        laborExtraHours: 4,
        laborTotal: 3060,
        subtotal: 3160,
        gst: 316,
        total: 3476,
        labourDisplayUnit: 'days',
      }),
      business,
    );
    expect(html).toContain('General Labour (+0.5 days @ $680.00/day)');
    expect(html).toContain('$340.00'); // 4h × $85 — the money is unit-agnostic
  });

  it('keeps a negative buffer readable as an adjustment', () => {
    const html = buildQuotePdfHtml(
      quoteData({ sections: canonicalSections, laborExtraHours: -2, laborTotal: 2550 }),
      business,
    );
    expect(html).toContain('Labour Adjustment');
    expect(html).toContain('-2 hours @ $85.00/hr');
  });

  it('falls back to the top-level figures when there are no sections', () => {
    const hours = buildQuotePdfHtml(quoteData({ laborHours: 32, laborRate: 85 }), business);
    expect(hours).toContain('32 hours @ $85.00/hr');

    const days = buildQuotePdfHtml(
      quoteData({ laborHours: 32, laborRate: 85, labourDisplayUnit: 'days' }),
      business,
    );
    expect(days).toContain('4 days @ $680.00/day');
  });

  it('converts a legacy top-level day record for display', () => {
    const html = buildQuotePdfHtml(
      quoteData({ laborHours: 4, laborRate: 680, laborUnit: 'days' }),
      business,
    );
    // 4 days at $680/day — shown in days because that is how it was stored.
    expect(html).toContain('4 days @ $680.00/day');
    expect(html).not.toContain('$5,440.00');
  });

  it('hides the per-line detail but keeps the totals when showLaborHours is off', () => {
    const html = buildQuotePdfHtml(
      quoteData({ sections: canonicalSections, showLaborHours: false }),
      business,
    );
    expect(html).not.toContain('@ $85.00/hr');
    expect(html).toContain('$2,550.00');
    expect(html).toContain('$170.00');
  });
});
