/**
 * Sections on the customer's document.
 *
 * Two things were wrong. The material table sorted its groups ALPHABETICALLY
 * while the labour block used sortOrder, so "Demolition" and "Painting" could
 * appear in one order at the top of the page and another further down. And a
 * material belonging to no section was printed under an invented heading
 * called "Other" — a group name the tradie never created.
 */

import { describe, it, expect } from 'vitest';
import { buildQuotePdfHtml, generateMaterialsHTML } from './htmlBuilders';
import type { QuotePdfData, BusinessPdfData, LaborSection, PdfMaterial } from './types';

const business: BusinessPdfData = { businessName: 'Test Trades', logoHtml: '' };

function material(name: string, section: string | undefined, totalPrice: number): PdfMaterial {
  return { name, quantity: 1, unit: 'each', price: totalPrice, totalPrice, section };
}

function labourSection(name: string, laborTotal: number, over: Partial<LaborSection> = {}): LaborSection {
  return {
    name,
    laborHours: laborTotal / 85,
    multiplier: 1,
    laborHoursTotal: laborTotal / 85,
    laborRate: 85,
    laborUnit: 'hours',
    laborTotal,
    ...over,
  };
}

/** Sections in a deliberately non-alphabetical order — that is the point. */
function quoteData(over: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'A Customer',
    quoteDate: '10 July 2026',
    job: { name: 'Repaint', description: 'Strip and repaint' },
    materials: [
      material('Skip bin', 'Demolition', 300),
      material('Low sheen 10L', 'Painting', 200),
    ],
    materialsSubtotal: 500,
    laborTotal: 1190,
    sections: [labourSection('Painting', 850), labourSection('Demolition', 340)],
    subtotal: 1690,
    markup: 0,
    markupAmount: 0,
    gst: 169,
    total: 1859,
    ...over,
  };
}

/** The order section names appear down the page, first mention wins. */
function orderOfMentions(html: string, names: string[]): string[] {
  return names
    .map((n) => ({ n, i: html.indexOf(n) }))
    .filter(({ i }) => i >= 0)
    .sort((a, b) => a.i - b.i)
    .map(({ n }) => n);
}

describe('PDF sections', () => {
  it('renders material and labour sections in the same order, never alphabetically', () => {
    const html = buildQuotePdfHtml(quoteData(), business);
    // The materials table and the labour table each mention both names; the
    // FIRST mention of each is its position in the materials table.
    expect(orderOfMentions(html, ['Painting', 'Demolition'])).toEqual(['Painting', 'Demolition']);
    // Reversing the sections array reverses both blocks together.
    const reversed = buildQuotePdfHtml(
      quoteData({ sections: [labourSection('Demolition', 340), labourSection('Painting', 850)] }),
      business,
    );
    expect(orderOfMentions(reversed, ['Painting', 'Demolition'])).toEqual(['Demolition', 'Painting']);
  });

  it('never renders a group named "Other"', () => {
    const html = generateMaterialsHTML(
      [material('Skip bin', 'Demolition', 300), material('Consumables', undefined, 40)],
      true,
      0,
      [labourSection('Demolition', 340)],
    );
    expect(html).not.toContain('Other');
    // The unsectioned line is still there, still priced, just not under an
    // invented heading.
    expect(html).toContain('Consumables');
    expect(html).toContain('<td colspan="3">Subtotal</td>');
    expect(html).toContain('<td colspan="3">Demolition Subtotal</td>');
  });

  it('renders a section description under its heading', () => {
    const html = generateMaterialsHTML(
      [material('Low sheen 10L', 'Painting', 200)],
      true,
      0,
      [labourSection('Painting', 850, { description: 'Two coats, low sheen.\nWalls and ceilings.' })],
    );
    expect(html).toContain('Painting<div class="section-scope">Two coats, low sheen.<br>Walls and ceilings.</div>');
  });

  it('escapes a section description', () => {
    const html = generateMaterialsHTML(
      [material('Trim', 'Painting', 200)],
      true,
      0,
      [labourSection('Painting', 850, { description: 'Gloss <all> trims & sills' })],
    );
    expect(html).toContain('Gloss &lt;all&gt; trims &amp; sills');
    expect(html).not.toContain('<all>');
  });

  it('groups materials by section without any business setting saying so', () => {
    // The groupMaterialsBySection gate is retired: labour sections already
    // rendered by default while material sections did not, so the same quote
    // showed its work broken out in one half of the document and lumped
    // together in the other.
    const html = buildQuotePdfHtml(quoteData({ groupMaterialsBySection: undefined }), business);
    expect(html).toContain('class="section-label"');
    expect(html).toContain('Painting Subtotal');
  });

  it('still renders one flat table when no material carries a section', () => {
    const html = buildQuotePdfHtml(
      quoteData({
        materials: [material('Skip bin', undefined, 300)],
        materialsSubtotal: 300,
        sections: undefined,
        laborTotal: 0,
        subtotal: 300,
        gst: 30,
        total: 330,
      }),
      business,
    );
    expect(html).not.toContain('class="section-label"');
    expect(html).toContain('<td colspan="3">Materials Subtotal</td>');
  });
});
