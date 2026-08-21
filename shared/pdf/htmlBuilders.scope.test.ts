/**
 * The Project Scope table — the customer-facing shape of a labour-dominant
 * quote. A painter, plasterer, cleaner or pest controller does not quote a
 * list of products with quantities; they quote two or three lumps of work,
 * each a title, a paragraph of scope, and one price.
 *
 * The mode is derived, never toggled: `isScopeQuote` requires EVERY line to be
 * a work item, so a document carrying so much as one real material can not
 * enter this branch. That is the safety property, and it is tested here
 * directly ("falls back to the four-column table…") as well as pinned by the
 * golden-string case at the bottom.
 */

import { describe, it, expect } from 'vitest';
import {
  buildQuotePdfHtml,
  buildInvoicePdfHtml,
  generateMaterialsHTML,
  generateScopeHTML,
  isScopeQuote,
} from './htmlBuilders';
import type { QuotePdfData, InvoicePdfData, BusinessPdfData, PdfMaterial } from './types';

const business: BusinessPdfData = {
  businessName: 'Test Trades',
  email: 'test@example.com',
  phone: '0400 000 000',
  abn: '12 345 678 901',
  logoHtml: '',
};

function work(over: Partial<PdfMaterial> = {}): PdfMaterial {
  return {
    name: 'Scope line',
    quantity: 1,
    unit: 'each',
    price: 100,
    totalPrice: 100,
    kind: 'work',
    ...over,
  };
}

function quoteData(over: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    customerName: 'A Customer',
    quoteDate: '10 July 2026',
    job: { name: 'Repaint', description: 'Full interior and exterior repaint' },
    materials: [work()],
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

/**
 * A real three-line painting quote: general preparation carried at $0, then
 * interior and exterior as single lump sums. Subtotal $43,950, GST $4,395,
 * total $48,345 — the numbers a tradie brought across from other software and
 * could not reproduce here.
 */
const PREP_SCOPE =
  'Including: Cover and protect any fixtures, fittings and floor surfaces; scrape back any flaking paint; ' +
  'fill cracks, gaps and imperfections with appropriate fillers; sand and dust all surfaces prior to painting.';

function painterQuote(): QuotePdfData {
  return quoteData({
    materials: [
      work({ name: 'General Preparation to be carried out', scope: PREP_SCOPE, price: 0, totalPrice: 0 }),
      work({
        name: 'INTERIOR Surfaces to be painted',
        scope: 'Surfaces included: walls, ceilings, doors, architraves and skirtings.\nScope of works: supplying of full interior as per plans provided.',
        price: 22750,
        totalPrice: 22750,
      }),
      work({
        name: 'EXTERIOR Surfaces to be painted',
        scope: 'Surfaces included: eaves, fascia, gutters, window frames and cladding.\nScope of works: painting of full exterior as per plans provided.',
        price: 21200,
        totalPrice: 21200,
      }),
    ],
    materialsSubtotal: 43950,
    subtotal: 43950,
    gst: 4395,
    total: 48345,
  });
}

describe('isScopeQuote', () => {
  it('is true only when every line is a work item', () => {
    expect(isScopeQuote([work(), work()])).toBe(true);
    expect(isScopeQuote([work(), { name: 'Paint', quantity: 2, unit: 'each', price: 60, totalPrice: 120 }])).toBe(false);
    expect(isScopeQuote([])).toBe(false);
  });

  // Regression: the materials screen's rapid-entry chain leaves a blank $0
  // draft behind, and one kind-less row used to drop a pure scope quote back
  // into the four-column materials table on the customer's PDF.
  it('ignores a blank draft row left behind by the entry screen', () => {
    const blank = { name: '', quantity: 1, unit: 'each', price: 0, totalPrice: 0 };
    expect(isScopeQuote([work(), work(), blank])).toBe(true);
    expect(isScopeQuote([work(), { name: '   ', quantity: 1, unit: 'each', price: 0, totalPrice: 0 }])).toBe(true);
  });

  it('is still false when a blank row sits beside a real material', () => {
    const blank = { name: '', quantity: 1, unit: 'each', price: 0, totalPrice: 0 };
    const real = { name: 'Paint', quantity: 2, unit: 'each', price: 60, totalPrice: 120 };
    expect(isScopeQuote([work(), real, blank])).toBe(false);
  });

  it('is false for a document that is nothing but blank rows', () => {
    expect(isScopeQuote([{ name: '', quantity: 1, unit: 'each', price: 0, totalPrice: 0 }])).toBe(false);
  });
});

describe('blank rows never reach the customer', () => {
  const blank = { name: '', quantity: 1, unit: 'each', price: 0, totalPrice: 0 };

  it('does not number a blank row in the scope table', () => {
    const q = painterQuote();
    const html = buildQuotePdfHtml({ ...q, materials: [...q.materials, blank] } as any, business);
    // Three real lines — there must be no fourth.
    expect(html).toContain('<td class="scope-num">3</td>');
    expect(html).not.toContain('<td class="scope-num">4</td>');
  });

  it('does not print an empty 1 each row in the itemised table', () => {
    const real = { name: 'Merbau decking', quantity: 48, unit: 'm', price: 14.38, totalPrice: 690 };
    const html = buildQuotePdfHtml(
      { ...painterQuote(), materials: [real, blank], materialsSubtotal: 690, subtotal: 690 } as any,
      business,
    );
    expect(html).toContain('Merbau decking');
    expect(html).not.toContain('<td></td>');
    expect((html.match(/<tr>/g) || []).length).toBeLessThan(6);
  });
});

describe('PDF Project Scope table', () => {
  it('renders a two-column Project Scope table when every line is a work item', () => {
    const html = buildQuotePdfHtml(painterQuote(), business);
    expect(html).toContain('<th>Project Scope</th>');
    expect(html).toContain('<th class="scope-total">Line Total</th>');
    // The itemised table's columns must be gone — that is the whole point.
    expect(html).not.toContain('<th>Quantity</th>');
    expect(html).not.toContain('Unit Price');
  });

  it('numbers the scope rows 1, 2, 3', () => {
    const html = buildQuotePdfHtml(painterQuote(), business);
    expect(html).toContain('<td class="scope-num">1</td>');
    expect(html).toContain('<td class="scope-num">2</td>');
    expect(html).toContain('<td class="scope-num">3</td>');
    expect(html).not.toContain('<td class="scope-num">4</td>');
  });

  it('renders the scope title in bold above the scope paragraph', () => {
    const html = generateScopeHTML([work({ name: 'INTERIOR', scope: 'Walls and ceilings.' })]);
    expect(html).toContain('<strong>INTERIOR</strong><div class="scope-body">Walls and ceilings.</div>');
  });

  it('converts newlines in a scope paragraph to <br>', () => {
    const html = generateScopeHTML([work({ scope: 'Line one\nLine two' })]);
    expect(html).toContain('Line one<br>Line two');
  });

  it('escapes HTML in a scope title and paragraph', () => {
    const html = generateScopeHTML([
      work({ name: 'Trim <treated> & sills', scope: 'Sand <all> surfaces & dust' }),
    ]);
    expect(html).toContain('<strong>Trim &lt;treated&gt; &amp; sills</strong>');
    expect(html).toContain('Sand &lt;all&gt; surfaces &amp; dust');
    expect(html).not.toContain('<treated>');
  });

  it('renders the title alone when the scope paragraph is empty', () => {
    const html = generateScopeHTML([work({ name: 'Make good', scope: '   ' })]);
    expect(html).toContain('<strong>Make good</strong></td>');
    expect(html).not.toContain('scope-body');
  });

  it('keeps a $0.00 scope line visible with a zero line total', () => {
    const html = buildQuotePdfHtml(painterQuote(), business);
    expect(html).toContain('General Preparation to be carried out');
    expect(html).toContain('<td class="scope-total">$0.00</td>');
  });

  it('omits the Materials heading and the separate Labour table in scope mode', () => {
    const html = buildQuotePdfHtml(painterQuote(), business);
    expect(html).not.toContain('<h3>Materials</h3>');
    expect(html).not.toContain('<h3>Labour</h3>');
  });

  it('collapses the summary to Subtotal, GST and TOTAL in scope mode', () => {
    const html = buildQuotePdfHtml(painterQuote(), business);
    expect(html).not.toContain('<span>Materials Subtotal</span>');
    expect(html).not.toContain('<span>Labour</span>');
    expect(html).toContain('<span>Subtotal (ex GST)</span>');
    expect(html).toContain('<span>GST (10%)</span>');
    expect(html).toContain('<span>TOTAL</span>');
  });

  it("reproduces a painter's three-line scope quote end to end", () => {
    const html = buildQuotePdfHtml(painterQuote(), business);
    expect(html).toContain('<td class="scope-total">$0.00</td>');
    expect(html).toContain('<td class="scope-total">$22,750.00</td>');
    expect(html).toContain('<td class="scope-total">$21,200.00</td>');
    expect(html).toContain('$43,950.00');
    expect(html).toContain('$4,395.00');
    expect(html).toContain('$48,345.00');
    // The scope paragraphs reach the page intact, one line per newline.
    expect(html).toContain('Scope of works: supplying of full interior as per plans provided.');
    expect(html).toContain('window frames and cladding.<br>Scope of works: painting of full exterior');
  });

  it('renders the same shape on the invoice as on the quote', () => {
    // An accepted scope quote must not change shape the moment it is invoiced.
    const invoice: InvoicePdfData = {
      ...painterQuote(),
      issueDate: '11 July 2026',
      dueDate: '25 July 2026',
    };
    const html = buildInvoicePdfHtml(invoice, business);
    expect(html).toContain('<th>Project Scope</th>');
    expect(html).not.toContain('<th>Quantity</th>');
    expect(html).toContain('<td class="scope-total">$22,750.00</td>');
  });

  it('falls back to the four-column table when any line is a real material', () => {
    const mixed = quoteData({
      materials: [
        work({ name: 'Prep', price: 500, totalPrice: 500 }),
        { name: 'Dulux Wash&Wear 10L', quantity: 4, unit: 'each', price: 95, totalPrice: 380 },
      ],
      materialsSubtotal: 880,
      subtotal: 880,
      gst: 88,
      total: 968,
    });
    const html = buildQuotePdfHtml(mixed, business);
    expect(html).toContain('<th>Quantity</th>');
    expect(html).toContain('<th class="num">Unit Price</th>');
    expect(html).toContain('<h3>Materials</h3>');
    expect(html).not.toContain('<th>Project Scope</th>');
  });

  it('renders a work item inside the four-column table with empty qty and unit-price cells', () => {
    const html = generateMaterialsHTML(
      [
        work({ name: 'Prep', scope: 'Cover and protect.', price: 500, totalPrice: 500 }),
        { name: 'Paint', quantity: 4, unit: 'each', price: 95, totalPrice: 380 },
      ],
    );
    expect(html).toContain('<td>Prep<div class="scope-body">Cover and protect.</div></td>\n      <td></td>\n      <td class="num"></td>\n      <td class="num">$500.00</td>');
    // The real material still shows both.
    expect(html).toContain('<td>4 each</td>');
    expect(html).toContain('<td class="num">$95.00</td>');
  });

  it('appends labour rows to the scope table when the doc also carries labour hours', () => {
    const html = buildQuotePdfHtml(
      quoteData({
        materials: [work({ name: 'Interior', price: 1000, totalPrice: 1000 })],
        materialsSubtotal: 1000,
        laborHours: 8,
        laborRate: 85,
        laborTotal: 680,
        subtotal: 1680,
        gst: 168,
        total: 1848,
      }),
      business,
    );
    // Row 1 is the scope line, row 2 is labour continuing the same numbering.
    expect(html).toContain('<td class="scope-num">1</td>');
    expect(html).toContain('<td class="scope-num">2</td>');
    expect(html).toContain('<strong>Labour</strong>');
    expect(html).toContain('<td class="scope-total">$680.00</td>');
    // …and there is still no second, separate Labour table.
    expect(html).not.toContain('<h3>Labour</h3>');
  });

  it('pins the four-column markup for a materials-only quote (anti-drift golden)', () => {
    // Nothing in the scope work may change what an ordinary materials quote
    // renders. This is that guarantee, written out in full.
    const html = generateMaterialsHTML(
      [
        { name: 'Merbau Decking 90x19mm', quantity: 12, unit: 'm', price: 8.5, totalPrice: 102 },
        { name: 'Galvanised Screws 65mm', quantity: 2, unit: 'box', price: 24, totalPrice: 48 },
      ],
      10,
    );
    expect(html).toBe(
      '\n      <table>\n        \n    <thead>\n      <tr>\n        <th>Item</th>\n' +
      '        <th>Quantity</th>\n        <th class="num">Unit Price</th>\n        <th class="num">Total</th>\n' +
      '      </tr>\n    </thead>\n        <tbody>\n          \n    <tr>\n' +
      '      <td>Merbau Decking 90x19mm</td>\n      <td>12 m</td>\n      <td class="num">$9.35</td>\n' +
      '      <td class="num">$112.20</td>\n    </tr>\n    <tr>\n      <td>Galvanised Screws 65mm</td>\n' +
      '      <td>2 box</td>\n      <td class="num">$26.40</td>\n      <td class="num">$52.80</td>\n    </tr>\n' +
      '          <tr class="total-row">\n            <td colspan="3">Materials Subtotal</td>\n' +
      '            <td class="num">$165.00</td>\n          </tr>\n        </tbody>\n      </table>',
    );
  });
});
