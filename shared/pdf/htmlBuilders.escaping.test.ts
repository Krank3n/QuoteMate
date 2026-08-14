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
import { generateMaterialsHTML, buildQuotePdfHtml } from './htmlBuilders';
import type { QuotePdfData, BusinessPdfData } from './types';

const business: BusinessPdfData = { businessName: 'Test Trades', logoHtml: '' };

describe('PDF escaping', () => {
  it('escapes a material name containing angle brackets and ampersands', () => {
    const html = generateMaterialsHTML(
      [{ name: 'Timber 90x45 <treated> & pine', quantity: 3, unit: 'm', price: 12, totalPrice: 36 }],
      false,
    );
    expect(html).toContain('Timber 90x45 &lt;treated&gt; &amp; pine');
    expect(html).not.toContain('<treated>');
  });

  it('escapes a unit and a section name', () => {
    const html = generateMaterialsHTML(
      [{ name: 'Sand', quantity: 2, unit: 'm<sup>3</sup>', price: 60, totalPrice: 120, section: 'Slab & Footings <stage 1>' }],
      true,
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
});
