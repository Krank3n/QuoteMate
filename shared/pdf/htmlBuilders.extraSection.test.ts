/**
 * The tradie's own standing section after the T&Cs.
 *
 * A painter asked for a "Preferred trades" block on every quote listing the
 * other businesses they recommend. Built as one general slot (heading + text,
 * set once in Business Defaults) so the same field carries recommended trades,
 * licence/insurance details or a warranty. Pin:
 *  - blank body = nothing printed; blank heading = a neutral default;
 *  - it sits after the T&Cs, on quotes only;
 *  - hand-typed text is escaped and keeps its line/paragraph breaks.
 */

import { describe, it, expect } from 'vitest';
import { buildQuotePdfHtml, buildInvoicePdfHtml, buildExtraSectionHTML } from './htmlBuilders';
import {
  resolveExtraSection,
  EXTRA_SECTION_DEFAULT_TITLE,
  EXTRA_SECTION_BODY_MAX,
  EXTRA_SECTION_TITLE_MAX,
} from './extraSection';
import type { QuotePdfData, InvoicePdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = { businessName: 'Lakeside Painting', logoHtml: '' };

function quoteData(over: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'A Customer',
    quoteDate: '24 September 2026',
    job: { name: 'Repaint', description: 'Interior repaint' },
    materials: [{ name: 'Low sheen 10L', quantity: 1, unit: 'each', price: 100, totalPrice: 100 }],
    materialsSubtotal: 100,
    laborTotal: 0,
    subtotal: 100,
    markup: 0,
    markupAmount: 0,
    gst: 10,
    total: 110,
    ...over,
  };
}

const partners = {
  title: 'Preferred trades',
  body: 'Smith Plastering — Dave, 0400 123 456\nBright Sparks Electrical — 0411 222 333',
};

describe('resolveExtraSection', () => {
  it('is undefined with no body, even when a heading is set', () => {
    expect(resolveExtraSection(undefined)).toBeUndefined();
    expect(resolveExtraSection({})).toBeUndefined();
    expect(resolveExtraSection({ extraSectionTitle: 'Preferred trades', extraSectionBody: '   \n ' })).toBeUndefined();
  });

  it('trims both fields and falls back to a neutral heading', () => {
    expect(resolveExtraSection({ extraSectionTitle: '  Preferred trades ', extraSectionBody: ' Dave 0400 \n' }))
      .toEqual({ title: 'Preferred trades', body: 'Dave 0400' });
    expect(resolveExtraSection({ extraSectionBody: 'Licence 12345' }))
      .toEqual({ title: EXTRA_SECTION_DEFAULT_TITLE, body: 'Licence 12345' });
  });

  it('ignores non-string values and caps runaway lengths', () => {
    expect(resolveExtraSection({ extraSectionTitle: 5, extraSectionBody: { x: 1 } })).toBeUndefined();
    const r = resolveExtraSection({ extraSectionTitle: 'T'.repeat(500), extraSectionBody: 'B'.repeat(9000) })!;
    expect(r.title).toHaveLength(EXTRA_SECTION_TITLE_MAX);
    expect(r.body).toHaveLength(EXTRA_SECTION_BODY_MAX);
  });
});

describe('extra section on the quote PDF', () => {
  it('prints nothing when there is no section', () => {
    expect(buildExtraSectionHTML(undefined)).toBe('');
    expect(buildQuotePdfHtml(quoteData(), business)).not.toContain('class="terms-section extra-section"');
  });

  it('prints the heading and each line of the body', () => {
    const html = buildQuotePdfHtml(quoteData({ extraSection: partners }), business);
    expect(html).toContain('<h3>Preferred trades</h3>');
    expect(html).toContain('Smith Plastering — Dave, 0400 123 456<br>Bright Sparks Electrical — 0411 222 333');
  });

  it('sits after the T&Cs', () => {
    const html = buildQuotePdfHtml(
      quoteData({ terms: 'Deposit due on acceptance.', extraSection: partners }),
      business,
    );
    const termsAt = html.indexOf('<h3>Terms &amp; Conditions</h3>');
    const extraAt = html.indexOf('<h3>Preferred trades</h3>');
    expect(termsAt).toBeGreaterThan(-1);
    expect(extraAt).toBeGreaterThan(termsAt);
  });

  it('still prints when the tradie has no T&Cs', () => {
    const html = buildQuotePdfHtml(quoteData({ extraSection: partners }), business);
    expect(html).not.toContain('Terms &amp; Conditions');
    expect(html).toContain('<h3>Preferred trades</h3>');
  });

  it('escapes hand-typed markup in the heading and body, and splits paragraphs', () => {
    const html = buildExtraSectionHTML({ title: '<b>Mates</b>', body: 'A & B <script>x</script>\n\nSecond para' });
    expect(html).toContain('<h3>&lt;b&gt;Mates&lt;/b&gt;</h3>');
    expect(html).toContain('<p>A &amp; B &lt;script&gt;x&lt;/script&gt;</p><p>Second para</p>');
    expect(html).not.toContain('<script>');
  });

  it('stays off invoices', () => {
    const invoice: InvoicePdfData = {
      ...quoteData({ extraSection: partners }),
      invoiceNumber: 'INV-001',
      issueDate: '24 September 2026',
      dueDate: '8 October 2026',
    };
    expect(buildInvoicePdfHtml(invoice, business)).not.toContain('Preferred trades');
  });
});
