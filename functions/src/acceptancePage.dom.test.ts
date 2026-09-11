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

/** Serve the page, stub the network, let the inline script render, return the DOM. */
async function renderAcceptance(quote: Record<string, unknown>): Promise<Document> {
  const html = generateAcceptancePage('a'.repeat(64));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    beforeParse(window) {
      (window as any).fetch = async () => ({
        json: async () => ({ success: true, quote, business }),
      });
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

/**
 * Render the page, then press Accept with respondToQuote answering `payment`
 * — the block the customer sees after accepting on the hosted page.
 */
async function acceptWith(payment: Record<string, unknown> | null): Promise<Document> {
  const html = generateAcceptancePage('a'.repeat(64));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    beforeParse(window) {
      (window as any).scrollTo = () => {};
      (window as any).fetch = async (url: string) => ({
        json: async () =>
          String(url).includes('/respondToQuote')
            ? { success: true, message: 'ok', payment }
            : { success: true, quote: baseQuote(), business },
      });
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 100; i++) {
    if (doc.querySelector('.totals-row')) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await (dom.window as any).respondToQuote('accepted');
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

describe('acceptance page — after pressing Accept', () => {
  it('plain quote with Square: an optional Pay now block for the full amount', async () => {
    const doc = await acceptWith({ kind: 'full', url: 'https://square.link/u/full', amount: 2029.64 });
    const state = doc.querySelector('.state.success')!;
    expect(state.querySelector('h2')?.textContent).toContain('Quote accepted');
    // Optional: the ordinary next step still leads.
    expect(state.querySelector('p')?.textContent).toContain(
      'Harbour City Plumbing has been notified and will be in touch to lock in a date',
    );
    const offer = doc.querySelector('.pay-offer[data-kind="full"]')!;
    expect(offer).not.toBeNull();
    expect(offer.querySelector('.pay-offer-label')?.textContent).toBe('Pay now if you like');
    expect(offer.querySelector('.pay-offer-amount')?.textContent).toBe('$2,029.64');
    const btn = offer.querySelector('a.btn-pay') as HTMLAnchorElement;
    expect(btn.textContent).toBe('Pay by card');
    expect(btn.getAttribute('href')).toBe('https://square.link/u/full');
    expect(offer.querySelector('.pay-offer-note')?.textContent).toBe(
      'Secure card payment through Square. Or Harbour City Plumbing will invoice you when the job’s done.',
    );
    expect((doc.getElementById('actionBar') as HTMLElement).style.display).toBe('none');
  });

  it('deposit quote: the Pay deposit block, with the lock-it-in message', async () => {
    const doc = await acceptWith({ kind: 'deposit', url: 'https://square.link/u/dep', amount: 500 });
    expect(doc.querySelector('.state.success p')?.textContent).toContain('please pay your deposit below');
    const offer = doc.querySelector('.pay-offer[data-kind="deposit"]')!;
    expect(offer.querySelector('.pay-offer-label')?.textContent).toBe('Deposit to get started');
    expect(offer.querySelector('.pay-offer-amount')?.textContent).toBe('$500.00');
    expect(offer.querySelector('a.btn-pay')?.textContent).toBe('Pay deposit securely');
    expect(offer.querySelector('.pay-offer-note')?.textContent).toContain(
      'Harbour City Plumbing is notified the moment it clears',
    );
    expect(doc.querySelector('[data-kind="full"]')).toBeNull();
  });

  it('nothing to pay (no Square, zero balance): the plain thank-you, no block', async () => {
    const doc = await acceptWith(null);
    expect(doc.querySelector('.state.success')).not.toBeNull();
    expect(doc.querySelector('.pay-offer')).toBeNull();
    expect(doc.querySelector('.state.success p')?.textContent).toContain('will be in touch to lock in a date');
  });

  it('a link that could break out of the href is not rendered either', async () => {
    const doc = await acceptWith({ kind: 'full', url: 'https://x/" onfocus=alert(1) autofocus x="', amount: 10 });
    expect(doc.querySelector('.pay-offer')).toBeNull();
    expect(doc.body.innerHTML).not.toContain('onfocus');
  });

  it('only an https link is ever rendered as a button', async () => {
    const doc = await acceptWith({ kind: 'full', url: 'javascript:alert(1)', amount: 10 });
    expect(doc.querySelector('.pay-offer')).toBeNull();
    expect(doc.querySelector('.state.success')).not.toBeNull();
  });
});
