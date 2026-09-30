import { describe, it, expect } from 'vitest';
import { scopeCoveredBySections, printedSectionScopes, sectionsCarryScope, SCOPE_BY_SECTION_NOTE } from './jobDetails';
import { buildQuotePdfHtml, buildInvoicePdfHtml } from './htmlBuilders';
import type { BusinessPdfData, LaborSection, PdfMaterial, QuotePdfData, InvoicePdfData } from './types';

const SCOPE = [
  'SCOPE OF WORKS',
  '',
  '1. Demolition',
  'Remove existing vanity, bath and wall tiles.',
  'Remove demolition waste from site.',
  '',
  '2. Waterproofing',
  'Supply and install waterproofing membrane to shower walls and floor.',
  '',
  '3. Tiling',
  'Install customer-supplied wall tiles floor to ceiling.',
  'Plumbing by others.',
].join('\n');

const DESCRIPTIONS: Record<string, string> = {
  Demolition: 'Remove existing vanity, bath and wall tiles.\nRemove demolition waste from site.',
  Waterproofing: 'Supply and install waterproofing membrane to shower walls and floor.',
  'Wall Tiling': 'Install customer-supplied wall tiles floor to ceiling.\nPlumbing by others.',
};

const section = (name: string, description?: string): LaborSection => ({
  name,
  laborHours: 4,
  multiplier: 1,
  laborHoursTotal: 4,
  laborRate: 85,
  laborUnit: 'hours',
  laborTotal: 340,
  ...(description ? { description } : {}),
});
const material = (name: string, sectionName: string): PdfMaterial => ({ name, quantity: 1, unit: 'each', price: 50, totalPrice: 50, section: sectionName });

const business: BusinessPdfData = { businessName: 'Test Trades', logoHtml: '' };

function quote(over: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'A Customer',
    quoteDate: '30 September 2026',
    job: { name: 'Bathroom renovation', description: SCOPE },
    materials: [material('Skip bin', 'Demolition'), material('Membrane', 'Waterproofing'), material('Tile adhesive', 'Wall Tiling')],
    materialsSubtotal: 150,
    laborTotal: 1020,
    sections: Object.entries(DESCRIPTIONS).map(([n, d]) => section(n, d)),
    subtotal: 1170,
    markup: 0,
    markupAmount: 0,
    gst: 117,
    total: 1287,
    ...over,
  };
}

describe('scopeCoveredBySections', () => {
  it('is covered when every line the tradie wrote prints under a section', () => {
    expect(scopeCoveredBySections(SCOPE, Object.values(DESCRIPTIONS))).toBe(true);
  });

  it('ignores case, punctuation and spacing', () => {
    const shouty = Object.values(DESCRIPTIONS).map((d) => d.toUpperCase().replace(/\./g, ''));
    expect(scopeCoveredBySections(SCOPE, shouty)).toBe(true);
  });

  it('is not covered when a line prints nowhere else (an exclusion, a note)', () => {
    const withExclusion = `${SCOPE}\n\nExcludes painting and electrical.`;
    expect(scopeCoveredBySections(withExclusion, Object.values(DESCRIPTIONS))).toBe(false);
  });

  it('is not covered when a section reworded one of the lines', () => {
    const reworded = { ...DESCRIPTIONS, Waterproofing: 'Waterproof the shower.' };
    expect(scopeCoveredBySections(SCOPE, Object.values(reworded))).toBe(false);
  });

  it('is not covered for a job that is not a written scope', () => {
    const prose = 'Supply and install 20m of 1.8m high Colorbond fencing along the back boundary, replacing the old paling fence.';
    expect(scopeCoveredBySections(prose, [prose])).toBe(false);
  });

  it('checks every bullet of a flat list, since each bullet is content', () => {
    const flat = [
      '- Remove the existing box gutter and downpipes from the rear of the house',
      '- Install a new box gutter, ten lineal metres, with new sumps',
      '- Connect to the existing stormwater and test for leaks before sign-off',
    ].join('\n');
    const all = ['Remove the existing box gutter and downpipes from the rear of the house', 'Install a new box gutter, ten lineal metres, with new sumps', 'Connect to the existing stormwater and test for leaks before sign-off'];
    expect(scopeCoveredBySections(flat, all)).toBe(true);
    expect(scopeCoveredBySections(flat, all.slice(0, 2))).toBe(false);
  });

  it('treats a numbered title with bullets under it as a heading', () => {
    const nested = [
      '1. Replace faulty light dimmer in the lounge room',
      '  * Supply and install a new LED-compatible dimmer',
      '2. Add two power points in the home office',
      '  * Supply and install two double power points',
      '3. Test and tag',
      '  * Test all new work and issue a certificate of compliance',
    ].join('\n');
    const printed = ['Supply and install a new LED-compatible dimmer', 'Supply and install two double power points', 'Test all new work and issue a certificate of compliance'];
    expect(scopeCoveredBySections(nested, printed)).toBe(true);
  });

  it('is not covered when nothing prints under a section', () => {
    expect(scopeCoveredBySections(SCOPE, [])).toBe(false);
  });
});

describe('printedSectionScopes', () => {
  it('counts only sections a material belongs to — a labour-only section is left out', () => {
    const scopes = printedSectionScopes([material('Skip bin', 'Demolition')], [section('Demolition', 'Remove it.'), section('Site clean', 'Sweep up.')]);
    expect(scopes).toEqual(['Remove it.']);
  });
});

describe('Job Details on the PDF', () => {
  it('prints the one-line note instead of the full scope when the sections carry it', () => {
    const html = buildQuotePdfHtml(quote(), business);
    expect(html).toContain(SCOPE_BY_SECTION_NOTE);
    // The scope still reaches the customer, once, under each section.
    expect(html).toContain('Remove demolition waste from site.');
    expect(html.split('Remove demolition waste from site.').length - 1).toBe(1);
    expect(html).not.toContain('SCOPE OF WORKS');
  });

  it('keeps the full description when any of it is not under a section', () => {
    const html = buildQuotePdfHtml(quote({ job: { name: 'Bathroom renovation', description: `${SCOPE}\nExcludes painting.` } }), business);
    expect(html).not.toContain(SCOPE_BY_SECTION_NOTE);
    expect(html).toContain('Excludes painting.');
  });

  it('keeps the full description on a Total-only quote, where sections do not print', () => {
    const html = buildQuotePdfHtml(quote({ priceDetail: 'total' }), business);
    expect(html).not.toContain(SCOPE_BY_SECTION_NOTE);
    expect(html).toContain('SCOPE OF WORKS');
  });

  it('keeps the full description on a quote whose sections have no scope text', () => {
    const html = buildQuotePdfHtml(quote({ sections: Object.keys(DESCRIPTIONS).map((n) => section(n)) }), business);
    expect(html).not.toContain(SCOPE_BY_SECTION_NOTE);
    expect(html).toContain('SCOPE OF WORKS');
  });

  it('applies the same rule on the invoice', () => {
    const inv = { ...quote(), invoiceNumber: 'INV-1', issueDate: '30 September 2026', dueDate: '14 October 2026' } as InvoicePdfData;
    const html = buildInvoicePdfHtml(inv, business);
    expect(html).toContain(SCOPE_BY_SECTION_NOTE);
    expect(html).not.toContain('SCOPE OF WORKS');
  });

  it('sectionsCarryScope is false for a work-item scope quote', () => {
    expect(sectionsCarryScope(quote(), { showLineItems: true, scopeMode: true })).toBe(false);
  });
});
