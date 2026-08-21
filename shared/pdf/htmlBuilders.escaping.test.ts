/**
 * Regression: material names, units and section names were interpolated into
 * the PDF raw. A tradie typing `Timber 90x45 <treated> & pine` — an ordinary
 * way to write it — silently corrupted the table on the customer's copy: the
 * browser swallowed `<treated>` as an unknown tag and the rest of the row
 * inherited whatever it opened.
 *
 * These cases fail on the pre-fix builders.
 */

import { describe, it, expect } from 'vitest';
import { generateMaterialsHTML, generatePaymentMethodsHTML, buildQuotePdfHtml } from './htmlBuilders';
import type { QuotePdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = { businessName: 'Test Trades', logoHtml: '' };

describe('PDF escaping', () => {
  it('escapes a material name containing angle brackets and ampersands', () => {
    const html = generateMaterialsHTML(
      [{ name: 'Timber 90x45 <treated> & pine', quantity: 3, unit: 'm', price: 12, totalPrice: 36 }],
    );
    expect(html).toContain('Timber 90x45 &lt;treated&gt; &amp; pine');
    expect(html).not.toContain('<treated>');
  });

  it('escapes a unit and a section name', () => {
    const html = generateMaterialsHTML(
      [{ name: 'Sand', quantity: 2, unit: 'm<sup>3</sup>', price: 60, totalPrice: 120, section: 'Slab & Footings <stage 1>' }],
    );
    expect(html).toContain('m&lt;sup&gt;3&lt;/sup&gt;');
    expect(html).toContain('Slab &amp; Footings &lt;stage 1&gt;');
    expect(html).not.toContain('<sup>');
  });

  it('escapes the notes block', () => {
    const quote: QuotePdfData = {
      customerName: 'A Customer',
      quoteDate: '10 July 2026',
      job: { name: 'Job', description: 'Work' },
      materials: [{ name: 'Thing', quantity: 1, unit: 'each', price: 10, totalPrice: 10 }],
      materialsSubtotal: 10,
      laborTotal: 0,
      subtotal: 10,
      markup: 0,
      markupAmount: 0,
      gst: 1,
      total: 11,
      notes: 'Access via side gate <north> & shed',
    };
    const html = buildQuotePdfHtml(quote, business);
    expect(html).toContain('Access via side gate &lt;north&gt; &amp; shed');
    expect(html).not.toContain('<north>');
  });

  it('keeps line breaks in the notes block', () => {
    // Notes used to be escaped without the newline treatment the job
    // description got, so a tradie's bullet-per-line notes collapsed into one
    // run-on sentence on the customer's copy.
    const quote: QuotePdfData = {
      customerName: 'A Customer',
      quoteDate: '10 July 2026',
      job: { name: 'Job', description: 'Work' },
      materials: [{ name: 'Thing', quantity: 1, unit: 'each', price: 10, totalPrice: 10 }],
      materialsSubtotal: 10,
      laborTotal: 0,
      subtotal: 10,
      markup: 0,
      markupAmount: 0,
      gst: 1,
      total: 11,
      notes: 'Power off at 7am\nDog in yard',
    };
    const html = buildQuotePdfHtml(quote, business);
    expect(html).toContain('Power off at 7am<br>Dog in yard');
  });

  it('escapes every tradie-typed payment method field', () => {
    // These were the only unescaped user text on the document: an "&" in an
    // account name corrupted the section, and markup could inject HTML into a
    // customer-facing PDF.
    const html = generatePaymentMethodsHTML({
      showOnDocuments: true,
      bankAccount: { enabled: true, accountName: 'Smith & Sons <Plumbing>', bsb: '<062-000>', accountNumber: '12 & 34' },
      payId: { enabled: true, payIdType: 'email', payIdValue: 'pay<at>smith&sons.au' },
      bpay: { enabled: true, billerCode: '<12345>', referenceNumber: 'REF&1' },
      paypal: { enabled: true, email: 'paypal<script>@x.com' },
      other: { enabled: true, instructions: 'Cash <preferred>\nSee & ask for Dave' },
    });
    expect(html).toContain('Smith &amp; Sons &lt;Plumbing&gt;');
    expect(html).toContain('&lt;062-000&gt;');
    expect(html).toContain('pay&lt;at&gt;smith&amp;sons.au');
    expect(html).toContain('&lt;12345&gt;');
    expect(html).toContain('REF&amp;1');
    expect(html).toContain('paypal&lt;script&gt;@x.com');
    // Instructions keep their line breaks AND their escaping.
    expect(html).toContain('Cash &lt;preferred&gt;<br>See &amp; ask for Dave');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<Plumbing>');
  });

  it('escapes the Square pay-now URL in both the href and the printed fallback', () => {
    const html = generatePaymentMethodsHTML(
      { showOnDocuments: true },
      { squarePaymentLinkUrl: 'https://square.link/u/x"><script>alert(1)</script>' },
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});
