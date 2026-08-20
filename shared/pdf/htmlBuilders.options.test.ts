/**
 * The customer's copy when a job is quoted two ways.
 *
 * One rule outranks everything else here: every option carries its own TOTAL
 * and the document carries none. A grand total on this page would state a
 * price nobody was offered — the same mistake that made sectioned options
 * charge for both, printed on the customer's copy where it does real damage.
 */

import { describe, it, expect } from 'vitest';
import { buildQuoteOptionsPdfHtml, buildQuotePdfHtml } from './htmlBuilders';
import type { QuotePdfData, BusinessPdfData, PdfMaterial } from './types';

const business: BusinessPdfData = { businessName: 'Coastal Hvac', logoHtml: '' };

const material = (name: string, totalPrice: number): PdfMaterial => ({
  name, quantity: 1, unit: 'each', price: totalPrice, totalPrice,
});

function option(over: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'Barb',
    quoteDate: '20 August 2026',
    job: { name: 'Aircon replacement', description: 'Replace the failed system.' },
    materials: [material('Multi head unit', 3723.5)],
    materialsSubtotal: 3723.5,
    laborTotal: 1000,
    subtotal: 4723.5,
    markup: 0,
    markupAmount: 0,
    gst: 472.35,
    total: 5195.85,
    ...over,
  };
}

const OPTION_A = option({ quoteNumber: 'QU-001', total: 6675.02 });
const OPTION_B = option({
  quoteNumber: 'QU-002',
  materials: [material('Split system x2', 3300)],
  total: 6116,
});

describe('a quote document with options', () => {
  it('prints a total for EVERY option', () => {
    const html = buildQuoteOptionsPdfHtml([OPTION_A, OPTION_B], business);

    expect(html).toContain('$6,675.02');
    expect(html).toContain('$6,116.00');
  });

  it('never prints the two added together', () => {
    const html = buildQuoteOptionsPdfHtml([OPTION_A, OPTION_B], business);

    // 6675.02 + 6116 = 12,791.02 — the figure the customer was never offered.
    expect(html).not.toContain('12,791.02');
    expect(html).not.toContain('12791.02');
  });

  it('labels the options so the customer can say which one they want', () => {
    const html = buildQuoteOptionsPdfHtml([OPTION_A, OPTION_B], business);

    expect(html).toContain('Option 1');
    expect(html).toContain('Option 2');
    expect(html).toContain('QU-001');
    expect(html).toContain('QU-002');
  });

  it('says in words that only one gets charged', () => {
    const html = buildQuoteOptionsPdfHtml([OPTION_A, OPTION_B], business);

    expect(html).toContain('never the total of them');
  });

  it('shows each option’s own line items', () => {
    const html = buildQuoteOptionsPdfHtml([OPTION_A, OPTION_B], business);

    expect(html).toContain('Multi head unit');
    expect(html).toContain('Split system x2');
  });

  it('prints the job once, not once per option', () => {
    const html = buildQuoteOptionsPdfHtml([OPTION_A, OPTION_B], business);

    // It is ONE job quoted two ways — repeating the brief reads as two jobs.
    expect(html.split('Replace the failed system.').length - 1).toBe(1);
    expect(html.split('Job Details').length - 1).toBe(1);
  });

  it('prints the terms and the validity note once', () => {
    const html = buildQuoteOptionsPdfHtml(
      [option({ terms: 'Payment due on completion.' }), option({ terms: 'Payment due on completion.' })],
      business,
    );

    expect(html.split('Payment due on completion.').length - 1).toBe(1);
    expect(html.split('valid for 30 days').length - 1).toBe(1);
  });

  it('carries the tradie’s business name in the footer, never ours', () => {
    const html = buildQuoteOptionsPdfHtml([OPTION_A, OPTION_B], business);

    expect(html).toContain('Coastal Hvac');
    expect(html).not.toContain('QuoteMate');
  });

  it('escapes what the tradie typed', () => {
    const html = buildQuoteOptionsPdfHtml(
      [option({ job: { name: '<script>x</script>', description: 'ok' } })],
      business,
    );

    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles three options', () => {
    const html = buildQuoteOptionsPdfHtml(
      [OPTION_A, OPTION_B, option({ quoteNumber: 'QU-003', total: 7000 })],
      business,
    );

    expect(html).toContain('Option 3');
    expect(html).toContain('$7,000.00');
  });

  it('lays each option out exactly as the single-quote document would', () => {
    // Both go through buildQuotePricingHTML, so a change to how a quote is
    // laid out reaches the options document too rather than drifting from it.
    const single = buildQuotePdfHtml(OPTION_A, business);
    const optionsDoc = buildQuoteOptionsPdfHtml([OPTION_A], business);

    expect(optionsDoc).toContain('Multi head unit');
    expect(single).toContain('Multi head unit');
    // Same totals block, same TOTAL.
    expect(optionsDoc).toContain('$6,675.02');
    expect(single).toContain('$6,675.02');
  });
});
