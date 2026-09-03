/**
 * The link-first customer quote email. The whole point of this template is to
 * make the acceptance link the primary action — only 3.7% of emailed quotes
 * ever had their link opened while the button sat below a PDF attachment — so
 * the button, its exact URL, its position above the summary, the plain-text
 * alternative and the "no QuoteMate branding to a customer" contract are all
 * pinned here. renderQuoteEmail is pure, so none of this touches Firestore or
 * the network.
 */
import { describe, expect, it } from 'vitest';
import { renderQuoteEmail, formatMoney, type RenderQuoteEmailInput } from './email';

const business = {
  name: 'Hansen Fencing',
  abn: '12 345 678 901',
  phone: '0412 345 678',
  email: 'tom@hansenfencing.com.au',
  brandColor: '#1d4ed8',
};

const ACCEPTANCE_URL = 'https://quotemateapp.au/q?token=abc123def456';

function input(over: Partial<RenderQuoteEmailInput> = {}): RenderQuoteEmailInput {
  return {
    customerName: 'Sarah Connor',
    emailBody: 'Thanks for having me out to look at the job.',
    jobName: 'Colorbond fence',
    materials: [],
    laborTotal: 3200,
    materialsSubtotal: 4180.5,
    subtotal: 7380.5,
    gst: 738.05,
    total: 8118.55,
    acceptanceUrl: ACCEPTANCE_URL,
    business,
    ...over,
  };
}

describe('renderQuoteEmail — the acceptance button', () => {
  it('renders the button with the exact acceptance URL', () => {
    const { html } = renderQuoteEmail(input());
    expect(html).toContain('View and accept your quote');
    expect(html).toContain(`href="${ACCEPTANCE_URL}"`);
  });

  it('places the button before the inline summary', () => {
    const { html } = renderQuoteEmail(
      input({
        materials: [
          { name: 'Panels', quantity: 10, unit: 'ea', totalPrice: 2200, section: 'Decking' },
        ],
      }),
    );
    const buttonAt = html.indexOf('View and accept your quote');
    const summaryAt = html.indexOf('Decking');
    expect(buttonAt).toBeGreaterThanOrEqual(0);
    expect(summaryAt).toBeGreaterThan(buttonAt);
  });

  it('reads as a real, tappable button (table cell, high-contrast, ≥44px tall)', () => {
    const { html } = renderQuoteEmail(input());
    // The <a> fills a table cell painted with the brand colour and white text,
    // with enough vertical padding to clear the 44px touch-target minimum.
    expect(html).toMatch(/background:#1d4ed8;[^"]*"[\s\S]*?padding:16px 24px;color:#ffffff/);
  });
});

describe('renderQuoteEmail — plain-text alternative', () => {
  it('carries the acceptance URL on its own line', () => {
    const { text } = renderQuoteEmail(input());
    const lines = text.split('\n');
    expect(lines).toContain(ACCEPTANCE_URL);
    // The URL line is bare — nothing else appended to it.
    const urlLine = lines.find((l) => l.includes(ACCEPTANCE_URL));
    expect(urlLine).toBe(ACCEPTANCE_URL);
  });

  it('keeps the same order as the HTML (greeting → total → link → summary → PDF note)', () => {
    const { text } = renderQuoteEmail(
      input({ materials: [{ name: 'Panels', quantity: 1, unit: 'ea', totalPrice: 2200, section: 'Decking' }] }),
    );
    const order = [
      text.indexOf('Hi Sarah,'),
      text.indexOf('Colorbond fence'),
      text.indexOf(ACCEPTANCE_URL),
      text.indexOf('Decking'),
      text.indexOf('A PDF copy of your quote is attached'),
    ];
    const sorted = [...order].sort((a, b) => a - b);
    expect(order.every((n) => n >= 0)).toBe(true);
    expect(order).toEqual(sorted);
  });
});

describe('renderQuoteEmail — tradie identity, never QuoteMate', () => {
  it('shows the business name, phone and email in both HTML and text', () => {
    const { html, text } = renderQuoteEmail(input());
    for (const surface of [html, text]) {
      expect(surface).toContain(business.name);
      expect(surface).toContain(business.phone);
      expect(surface).toContain(business.email);
    }
  });

  it('never leaks the QuoteMate name into the HTML or the text', () => {
    const { html, text } = renderQuoteEmail(input());
    expect(html).not.toContain('QuoteMate');
    expect(text).not.toContain('QuoteMate');
  });

  it('greets the customer by first name, and falls back gracefully', () => {
    expect(renderQuoteEmail(input()).text).toContain('Hi Sarah,');
    // A business-shaped name is not greeted as a person.
    expect(renderQuoteEmail(input({ customerName: 'Plumbing Services' })).text).toContain('Hi there,');
    expect(renderQuoteEmail(input({ customerName: '' })).text).toContain('Hi there,');
  });
});

describe('renderQuoteEmail — totals and the inline summary', () => {
  it('shows the document total, GST-inclusive, formatted like the PDF', () => {
    const { html, text } = renderQuoteEmail(input());
    expect(html).toContain(formatMoney(8118.55)); // $8,118.55
    expect(html).toContain('Total (inc GST)');
    expect(text).toContain('Total (inc GST): $8,118.55');
  });

  it('drops the GST label when the business is not registered', () => {
    const { html } = renderQuoteEmail(input({ gstRegistered: false }));
    expect(html).toContain('>Total<');
    expect(html).not.toContain('Total (inc GST)');
  });

  it('summarises by section total, not by material line', () => {
    const { html } = renderQuoteEmail(
      input({
        materials: [
          { name: 'Hardwood posts', quantity: 12, unit: 'ea', totalPrice: 900, section: 'Framing' },
          { name: 'Bearers', quantity: 6, unit: 'ea', totalPrice: 600, section: 'Framing' },
          { name: 'Decking boards', quantity: 40, unit: 'ea', totalPrice: 2000, section: 'Decking' },
        ],
      }),
    );
    // Section names + section totals ($1,500 framing, $2,000 decking), not the
    // individual material lines.
    expect(html).toContain('Framing');
    expect(html).toContain(formatMoney(1500));
    expect(html).toContain('Decking');
    expect(html).toContain(formatMoney(2000));
    expect(html).not.toContain('Hardwood posts');
  });

  it('reconciles section totals with hidden markup folded into the lines', () => {
    // As the caller hands them over: applyHideMarkupForDisplay has already
    // folded the 10% markup into each line's totalPrice. The section total must
    // show the marked-up figure ($330), never the pre-markup base ($300).
    const { html, text } = renderQuoteEmail(
      input({
        materials: [
          { name: 'Base A', quantity: 1, unit: 'ea', totalPrice: 110, section: 'Site works' },
          { name: 'Base B', quantity: 1, unit: 'ea', totalPrice: 220, section: 'Site works' },
        ],
        materialsSubtotal: 330,
      }),
    );
    expect(html).toContain('Site works');
    expect(html).toContain(formatMoney(330));
    expect(html).not.toContain(formatMoney(300));
    expect(text).toContain(`Site works: ${formatMoney(330)}`);
  });

  it('falls back to Materials/Labour subtotals when there are no sections', () => {
    const { html, text } = renderQuoteEmail(
      input({ materials: [{ name: 'Sundries', quantity: 1, unit: 'lot', totalPrice: 4180.5 }] }),
    );
    expect(html).toContain('Materials');
    expect(html).toContain(formatMoney(4180.5));
    expect(html).toContain('Labour');
    expect(html).toContain(formatMoney(3200));
    expect(text).toContain(`Materials: ${formatMoney(4180.5)}`);
    expect(text).toContain(`Labour: ${formatMoney(3200)}`);
  });

  it('hides the breakdown when the tradie chose total-only pricing', () => {
    const { html } = renderQuoteEmail(
      input({
        priceDetail: 'total',
        materials: [{ name: 'Panels', quantity: 1, unit: 'ea', totalPrice: 2200, section: 'Decking' }],
      }),
    );
    expect(html).not.toContain("What's included");
    expect(html).not.toContain('Decking');
    // The grand total is still shown.
    expect(html).toContain(formatMoney(8118.55));
  });
});

describe('renderQuoteEmail — no acceptance URL', () => {
  it('falls back to the current layout without a broken button', () => {
    const { html, text } = renderQuoteEmail(input({ acceptanceUrl: undefined }));
    expect(html).not.toContain('View and accept your quote');
    expect(html).not.toContain('href=""');
    expect(html).not.toContain('href="undefined"');
    // Still a real email: the total and the business are there.
    expect(html).toContain(formatMoney(8118.55));
    expect(html).toContain(business.name);
    expect(text).not.toContain('View and accept your quote');
  });

  it('treats a blank acceptance URL the same as none', () => {
    const { html } = renderQuoteEmail(input({ acceptanceUrl: '   ' }));
    expect(html).not.toContain('View and accept your quote');
    expect(html).not.toContain('href="   "');
  });
});
