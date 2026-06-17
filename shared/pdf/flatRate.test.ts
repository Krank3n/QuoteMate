import { describe, it, expect } from 'vitest';
import { buildQuotePdfHtml, buildFlatRateLineHTML } from './htmlBuilders';
import type { QuotePdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = {
  businessName: 'Acme Insulation',
  email: 'quotes@example.com',
  phone: '0400 000 000',
};

const baseQuote: QuotePdfData = {
  customerName: 'Sam Tester',
  quoteDate: '09 June 2026',
  job: { name: 'R4.1 Ceiling Insulation', description: 'Supply and fit' },
  materials: [
    { name: 'R4.1 batts', quantity: 13, unit: 'each', price: 50, totalPrice: 650 },
    { name: 'Tape', quantity: 1, unit: 'each', price: 20, totalPrice: 20 },
  ],
  materialsSubtotal: 670,
  laborTotal: 1500,
  subtotal: 2170,
  markup: 0,
  markupAmount: 0,
  gst: 217,
  total: 2387,
};

describe('flat-rate presentation mode', () => {
  it('itemised mode shows the Materials table', () => {
    const html = buildQuotePdfHtml({ ...baseQuote }, business);
    expect(html).toContain('Materials');
    expect(html).toContain('R4.1 batts');
    expect(html).toContain('Materials Subtotal');
  });

  it('flatRate mode suppresses the Materials and Labour tables', () => {
    const html = buildQuotePdfHtml(
      {
        ...baseQuote,
        presentationMode: 'flatRate',
        flatRateLineLabel: 'R4.1 Ceiling Insulation — supply & fit',
      },
      business
    );
    expect(html).not.toContain('R4.1 batts');
    expect(html).not.toContain('Materials Subtotal');
    // The flat-rate label should be the only line item.
    expect(html).toContain('R4.1 Ceiling Insulation — supply &amp; fit');
    // Total must still render.
    expect(html).toContain('$2,387');
  });

  it('flatRate mode renders inclusions bullets when provided', () => {
    const html = buildQuotePdfHtml(
      {
        ...baseQuote,
        presentationMode: 'flatRate',
        flatRateInclusions: [
          'Supply and fit R4.1 ceiling insulation',
          'Site clean & rubbish removal',
        ],
      },
      business
    );
    expect(html).toContain('<li>Supply and fit R4.1 ceiling insulation</li>');
    expect(html).toContain('<li>Site clean &amp; rubbish removal</li>');
  });

  it('falls back to the job name when flatRateLineLabel is missing', () => {
    const html = buildFlatRateLineHTML({
      ...baseQuote,
      presentationMode: 'flatRate',
    });
    expect(html).toContain('R4.1 Ceiling Insulation');
  });

  it('escapes HTML in the label and inclusions', () => {
    const html = buildFlatRateLineHTML({
      ...baseQuote,
      presentationMode: 'flatRate',
      flatRateLineLabel: '<script>alert(1)</script>',
      flatRateInclusions: ['<b>bad</b>'],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
  });
});
