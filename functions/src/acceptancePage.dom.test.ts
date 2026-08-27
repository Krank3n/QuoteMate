/**
 * Executes the acceptance page's inline browser script against a real DOM.
 *
 * The sibling acceptancePage.test.ts parses the script (a SyntaxError can't
 * ship) but never RUNS it — a runtime error or a wrong render in renderQuote
 * would pass every assertion there. Here the script actually fetches (a
 * stub), renders, and we assert on the DOM the customer sees, pinning the
 * GST placement rules end to end: exclusive GST is an addend in the stack;
 * inclusive is a disclosure under the total; not-registered gets the no-GST
 * note. Same rules as shared/pdf/htmlBuilders.buildSummaryHTML.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { generateAcceptancePage } from './index';

const business = { name: 'Harbour City Plumbing', brandColor: '#059669' };

function baseQuote(over: Record<string, unknown> = {}) {
  return {
    customerName: 'Sarah Thompson',
    jobName: 'Bathroom renovation',
    jobDescription: 'Rough-in and fit-off',
    quoteNumber: 'Q-1',
    createdAt: '2026-08-21',
    materials: [
      { name: 'Copper pipe', quantity: 2, unit: 'm', price: 10, totalPrice: 20 },
    ],
    materialsSubtotal: 20,
    laborTotal: 100,
    subtotal: 120,
    gst: 12,
    total: 132,
    priceDetail: 'itemised',
    ...over,
  };
}

/** Every URL the page asked for, so a test can assert what it did NOT ask for. */
let fetched: string[] = [];

/** Serve the page, stub the network, let the inline script render, return the DOM. */
async function renderAcceptance(
  quote: Record<string, unknown>,
  intent?: 'accept' | 'decline',
): Promise<Document> {
  fetched = [];
  const html = generateAcceptancePage('a'.repeat(64), intent);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    beforeParse(window) {
      (window as any).fetch = async (url: string) => {
        fetched.push(String(url));
        return { json: async () => ({ success: true, quote, business }) };
      };
    },
  });
  // loadQuote() fires at parse time and renders asynchronously — poll for it.
  const doc = dom.window.document;
  for (let i = 0; i < 100; i++) {
    if (doc.querySelector('.totals-row')) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  return doc;
}

function rowLabels(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('.totals-row span:first-child')).map(
    (el) => el.textContent || '',
  );
}

describe('acceptance page — rendered DOM', () => {
  it('renders the quote at all (script executes without a runtime error)', async () => {
    const doc = await renderAcceptance(baseQuote());
    // Scope to the rendered container — body.textContent would also match the
    // inline script's own source code.
    const content = doc.getElementById('content')!.textContent!;
    expect(content).toContain('Bathroom renovation');
    expect(content).toContain('Copper pipe');
    expect(doc.querySelector('.totals-row.grand')?.textContent).toContain('$132.00');
  });

  it('exclusive: GST (10%) is an addend in the stack, no disclosure note', async () => {
    const doc = await renderAcceptance(baseQuote());
    expect(rowLabels(doc)).toContain('GST (10%)');
    expect(doc.getElementById('content')!.textContent).not.toContain('Total includes GST of');
    expect(doc.querySelector('.gst-note')).toBeNull();
  });

  it('inclusive: no GST row in the stack; disclosure sits after the total', async () => {
    const doc = await renderAcceptance(
      baseQuote({ pricesIncludeGst: true, subtotal: 132, gst: 12, total: 132 }),
    );
    expect(rowLabels(doc)).not.toContain('GST (10%)');
    expect(rowLabels(doc)).not.toContain('Includes GST');
    const note = doc.querySelector('.gst-note');
    expect(note?.textContent).toBe('Total includes GST of $12.00');
    // DOM order: the note follows the grand-total row.
    const grand = doc.querySelector('.totals-row.grand')!;
    expect(grand.compareDocumentPosition(note!) & 4 /* DOCUMENT_POSITION_FOLLOWING */).toBeTruthy();
  });

  it('not registered: no GST row, the no-GST note under the total', async () => {
    const doc = await renderAcceptance(
      baseQuote({ gstRegistered: false, gst: 0, total: 120 }),
    );
    expect(rowLabels(doc)).not.toContain('GST (10%)');
    expect(doc.querySelector('.gst-note')?.textContent).toContain('No GST has been charged');
  });
});

/**
 * The email's Decline / Accept buttons arrive as ?action=…, and the server
 * answers with this page instead of recording anything — a link scanner must
 * not be able to answer for the customer. What the page does with that intent
 * is the other half of the fix, and it has to stop short of submitting.
 */
describe('acceptance page — the intent from the email link', () => {
  it('decline: prompts and rings Decline without sending a response', async () => {
    const doc = await renderAcceptance(baseQuote(), 'decline');

    const prompt = doc.querySelector('#respondStep .confirm-step');
    expect(prompt?.textContent).toContain('Decline quote');
    expect(prompt?.textContent).toContain('Harbour City Plumbing');
    expect(doc.getElementById('declineBtn')?.className).toContain('btn-primed');
    expect(doc.getElementById('acceptBtn')?.className).not.toContain('btn-primed');
    // Loading the quote is the only call it may make. respondToQuote is the
    // customer's tap, never the page's own doing.
    expect(fetched.some((u) => u.includes('respondToQuote'))).toBe(false);
  });

  it('accept: rings Accept without sending a response', async () => {
    const doc = await renderAcceptance(baseQuote(), 'accept');

    expect(doc.querySelector('#respondStep .confirm-step')?.textContent).toContain('Accept quote');
    expect(doc.getElementById('acceptBtn')?.className).toContain('btn-primed');
    expect(doc.getElementById('declineBtn')?.className).not.toContain('btn-primed');
    expect(fetched.some((u) => u.includes('respondToQuote'))).toBe(false);
  });

  it('no intent: no prompt, no ringed button', async () => {
    const doc = await renderAcceptance(baseQuote());

    expect(doc.querySelector('.confirm-step')).toBeNull();
    expect(doc.getElementById('acceptBtn')?.className).not.toContain('btn-primed');
    expect(doc.getElementById('declineBtn')?.className).not.toContain('btn-primed');
  });
});
