/**
 * The customer-facing quote/invoice email and the page the Accept/Decline
 * links land on. Both shipped untested — the accept/decline block is the one
 * piece of QuoteMate a paying customer actually clicks, so the URLs, the
 * escaping and the "both options are visible" contract are pinned here.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDocumentEmailHtml,
  buildQuoteReminderEmailHtml,
  formatMoney,
  safeBrandColor,
  remoteLogoUrl,
} from './email';
import { generateConfirmationPage } from './index';

const business = {
  name: 'Hansen Fencing',
  abn: '12 345 678 901',
  phone: '0412 345 678',
  email: 'tom@hansenfencing.com.au',
  brandColor: '#1d4ed8',
};

const ACCEPTANCE_URL = 'https://quotemateapp.au/q?token=abc123';

function quote(over: Record<string, any> = {}) {
  return buildDocumentEmailHtml({
    type: 'quote',
    customerName: 'Sarah',
    emailBody: 'Quote attached.',
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
  } as any);
}

function invoice(over: Record<string, any> = {}) {
  return buildDocumentEmailHtml({
    type: 'invoice',
    customerName: 'Sarah',
    emailBody: 'Invoice attached.',
    jobName: 'Colorbond fence',
    materials: [],
    laborTotal: 3200,
    materialsSubtotal: 4180.5,
    subtotal: 7380.5,
    gst: 738.05,
    total: 8118.55,
    invoiceNumber: 'INV-0042',
    dueDate: '2026-09-01T00:00:00.000Z',
    business,
    ...over,
  } as any);
}

// Count occurrences of a literal in the *visible* email — the hidden
// preheader legitimately repeats the total for the inbox list view.
function countVisible(html: string, needle: string): number {
  const body = html.replace(/<div style="display:none;[\s\S]*?<\/div>/, '');
  return body.split(needle).length - 1;
}

describe('formatMoney', () => {
  it('groups thousands and always shows cents', () => {
    expect(formatMoney(8118.55)).toBe('$8,118.55');
    expect(formatMoney(1234567.1)).toBe('$1,234,567.10');
    expect(formatMoney(330)).toBe('$330.00');
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('keeps the sign outside the dollar symbol', () => {
    expect(formatMoney(-2029.64)).toBe('-$2,029.64');
  });

  it('never renders NaN at a customer', () => {
    expect(formatMoney(NaN)).toBe('$0.00');
    expect(formatMoney(undefined as unknown as number)).toBe('$0.00');
  });
});

describe('safeBrandColor', () => {
  it('passes through the hex the colour picker writes', () => {
    expect(safeBrandColor('#1d4ed8')).toBe('#1d4ed8');
    expect(safeBrandColor('#FFF')).toBe('#FFF');
    expect(safeBrandColor('  #059669  ')).toBe('#059669');
  });

  it('falls back rather than interpolating anything that could break out', () => {
    // The colour lands inside style="background:${accent}" and inside a
    // <style> block on the confirmation page.
    expect(safeBrandColor('red;"onload="alert(1)')).toBe('#059669');
    expect(safeBrandColor('#fff}</style><script>alert(1)</script>')).toBe('#059669');
    expect(safeBrandColor('')).toBe('#059669');
    expect(safeBrandColor(undefined)).toBe('#059669');
    expect(safeBrandColor(null)).toBe('#059669');
  });

  it('keeps a hostile brand colour out of the rendered email and page', () => {
    const hostile = '#fff"onmouseover="alert(1)';
    expect(quote({ business: { ...business, brandColor: hostile } })).not.toContain('onmouseover');
    expect(generateConfirmationPage('accepted', 'Thanks!', 'Hansen Fencing', hostile))
      .not.toContain('onmouseover');
  });
});

describe('remoteLogoUrl', () => {
  it('keeps a logo the recipient can actually fetch', () => {
    expect(remoteLogoUrl('https://storage.googleapis.com/x/logo.png'))
      .toBe('https://storage.googleapis.com/x/logo.png');
    expect(remoteLogoUrl('  http://example.test/logo.png  '))
      .toBe('http://example.test/logo.png');
  });

  it('drops anything the recipient cannot fetch', () => {
    // Both exist on real accounts today and render as a broken-image icon.
    expect(remoteLogoUrl('file:///var/mobile/Containers/Data/logo.png')).toBeUndefined();
    expect(remoteLogoUrl('data:image/png;base64,iVBORw0KGgo=')).toBeUndefined();
    expect(remoteLogoUrl('content://media/external/images/1')).toBeUndefined();
    expect(remoteLogoUrl('')).toBeUndefined();
    expect(remoteLogoUrl(undefined)).toBeUndefined();
    expect(remoteLogoUrl(null)).toBeUndefined();
  });

  it('falls back to the business-name lockup rather than a broken image', () => {
    const withLocal = quote({ business: { ...business, logoUrl: 'file:///var/mobile/logo.png' } });
    expect(withLocal).not.toContain('file:///var/mobile/logo.png');
    expect(withLocal).not.toContain('<img');
    expect(withLocal).toContain('Hansen Fencing');

    const withRemote = quote({ business: { ...business, logoUrl: 'https://cdn.test/logo.png' } });
    expect(withRemote).toContain('<img src="https://cdn.test/logo.png"');
  });
});

describe('quote email — accept / decline', () => {
  it('links Accept and Decline to the acceptance URL with the right action', () => {
    const html = quote();
    expect(html).toContain('https://quotemateapp.au/q?token=abc123&amp;action=accept');
    expect(html).toContain('https://quotemateapp.au/q?token=abc123&amp;action=decline');
  });

  it('starts a query string when the acceptance URL has none', () => {
    const html = quote({ acceptanceUrl: 'https://quotemateapp.au/q/abc123' });
    expect(html).toContain('https://quotemateapp.au/q/abc123?action=accept');
    expect(html).toContain('https://quotemateapp.au/q/abc123?action=decline');
  });

  it('offers both choices — Decline is a real button, not a hidden grey link', () => {
    const html = quote();
    expect(html).toContain('Decline quote');
    // Regression: Decline used to be #9ca3af underlined text (~2.3:1 contrast,
    // fails WCAG AA) which also read as a nudge away from saying no.
    expect(html).not.toMatch(/color:#9ca3af;font-size:14px;text-decoration:underline/);
    expect(html).toContain('color:#4b5563');
  });

  it('renders no accept/decline block when there is no acceptance URL', () => {
    const html = quote({ acceptanceUrl: undefined });
    expect(html).not.toContain('action=accept');
    expect(html).not.toContain('Decline quote');
    expect(html).not.toContain('Happy to go ahead?');
  });

  it('sends the primary button to Square when a deposit link exists, and still offers Decline', () => {
    const html = quote({
      depositAmount: 2029.64,
      depositPercentage: 25,
      depositPayNowUrl: 'https://square.link/u/demo',
    });
    expect(html).toContain('href="https://square.link/u/demo"');
    expect(html).toContain('Accept &amp; Pay Deposit');
    // The deposit link replaces Accept only — Decline must survive.
    expect(html).toContain('token=abc123&amp;action=decline');
    expect(html).toContain('$2,029.64');
    expect(html).toContain('Deposit to get started (25%)');
  });

  it('only discloses the surcharge and terms when a card payment is actually offered', () => {
    const withCard = quote({
      depositAmount: 2029.64,
      depositPayNowUrl: 'https://square.link/u/demo',
      surchargePaymentFees: true,
      hasTerms: true,
    });
    expect(withCard).toMatch(/processing fee/);
    expect(withCard).toContain('By paying you accept the Terms');

    const noCard = quote({ depositAmount: 2029.64, surchargePaymentFees: true, hasTerms: true });
    expect(noCard).not.toMatch(/processing fee/);
    expect(noCard).not.toContain('By paying you accept the Terms');
  });

  it('names the business in the reassurance line', () => {
    expect(quote()).toContain('Hansen Fencing gets notified straight away');
  });

  it('uses the business brand colour for the primary button', () => {
    expect(quote()).toContain('background:#1d4ed8');
  });

  it('drops the hardcoded 30-day validity line when the tradie has terms', () => {
    // The PDF defers to the tradie's T&Cs (which may say 14 days); the email
    // body must not contradict the attachment.
    expect(quote()).toContain('valid for 30 days');
    expect(quote({ hasTerms: true })).not.toContain('valid for 30 days');
  });
});

describe('document email — escaping', () => {
  it('escapes customer-, job- and business-supplied text', () => {
    const html = quote({
      customerName: '<script>alert(1)</script>',
      jobName: 'Fence "&" gate <b>',
      business: { ...business, name: '<img src=x onerror=alert(1)>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes the hidden preheader too', () => {
    const html = quote({ jobName: '</div><script>alert(1)</script>' });
    expect(html).not.toContain('</div><script>alert(1)</script>');
  });

  it('escapes the acceptance URL in the href', () => {
    const html = quote({ acceptanceUrl: 'https://x.test/q?t=1"onmouseover="alert(1)' });
    expect(html).not.toContain('"onmouseover="alert(1)');
  });
});

describe('quote email — summary card', () => {
  it("collapses to the total alone when priceDetail 'total' meets no GST", () => {
    // Nothing left to break down — the card used to render a "Summary"
    // heading over an empty box.
    const html = quote({
      priceDetail: 'total',
      gstRegistered: false,
      gst: 0,
      total: 3025,
    });
    expect(html).not.toContain('Summary');
    expect(html).toContain('$3,025.00');
    expect(html).toContain('No GST has been charged.');
  });

  it("keeps GST visible in 'total' mode — it's a disclosure, not a preference", () => {
    const html = quote({ priceDetail: 'total' });
    expect(html).toContain('Summary');
    expect(html).toContain('GST');
    expect(html).not.toContain('Materials');
  });

  it("keeps the subtotal in 'summary' mode", () => {
    const html = quote({ priceDetail: 'summary', gstRegistered: false, gst: 0 });
    expect(html).toContain('Summary');
    expect(html).toContain('Subtotal');
  });

  it('still honours the deprecated show* pair', () => {
    const html = quote({ showMaterialCosts: false, showLaborCosts: false });
    expect(html).toContain('Summary');
    expect(html).toContain('GST');
  });
});

describe('quote email — email-open pixel', () => {
  const PIXEL = 'https://us-central1-hansendev.cloudfunctions.net/trackEmailOpen?t=deadbeef';

  it('embeds the pixel as a 1x1 <img> at the end when a URL is supplied', () => {
    const html = quote({ emailOpenPixelUrl: PIXEL });
    expect(html).toContain(`src="${PIXEL}"`);
    // Zero visible weight: 1x1, display:block, no border, no alt text.
    expect(html).toMatch(/width="1"\s+height="1"/);
    expect(html).toContain('display:block');
    // Must sit at the very end so a partial-load client still counts the open.
    const pixelIdx = html.indexOf(PIXEL);
    const bodyEnd = html.lastIndexOf('</body>');
    expect(pixelIdx).toBeGreaterThan(-1);
    expect(pixelIdx).toBeLessThan(bodyEnd);
    // Nothing between the pixel and </body> but whitespace and the wrapper closing tags.
    const trailing = html.slice(pixelIdx, bodyEnd);
    expect(trailing).not.toMatch(/<img[^>]*src="(?!https:\/\/us-central1-hansendev)/i);
  });

  it('renders no pixel when no URL is supplied (test sends, older callers)', () => {
    const html = quote();
    expect(html).not.toContain('trackEmailOpen');
    // No stray width=1 height=1 img either.
    expect(html).not.toMatch(/width="1"\s+height="1"/);
  });

  it('never adds a pixel to an invoice email — instrumentation is quote-only', () => {
    const html = invoice({ emailOpenPixelUrl: PIXEL } as any);
    expect(html).not.toContain(PIXEL);
    expect(html).not.toContain('trackEmailOpen');
  });

  it('escapes a hostile pixel URL rather than breaking out of the src attribute', () => {
    const hostile = 'https://x.test/p?t=abc"onload="alert(1)';
    const html = quote({ emailOpenPixelUrl: hostile });
    // The double-quote is escaped so the src attribute stays intact and the
    // hostile fragment lands inside it as a data value, not as an attribute.
    expect(html).not.toContain('"onload="alert(1)');
    expect(html).toContain('&quot;onload=&quot;alert(1)');
  });
});

describe('quote email — money', () => {
  it('renders totals with thousands separators', () => {
    const html = quote();
    expect(html).toContain('$8,118.55');
    expect(html).toContain('$4,180.50');
    expect(html).not.toContain('$8118.55');
  });
});

describe('invoice email', () => {
  it('states the amount due once, with its due date and reference beside it', () => {
    const html = invoice();
    expect(countVisible(html, '$8,118.55')).toBe(1);
    expect(html).toContain('Due 1 September 2026');
    expect(html).toContain('Reference INV-0042');
    // Regression: a second "Payment Information" card repeated the same
    // amount and due date directly under the summary.
    expect(html).not.toContain('Payment Information');
  });

  it('labels the payment methods by whether a Pay now button is offered', () => {
    const methods = {
      showOnDocuments: true,
      bankAccount: { enabled: true, accountName: 'Hansen Fencing', bsb: '063-000', accountNumber: '1234 5678' },
    };
    expect(invoice({ plan: 'pro', paymentMethods: methods, payNowUrl: 'https://square.link/u/demo' }))
      .toContain('Other ways to pay');
    expect(invoice({ plan: 'pro', paymentMethods: methods }))
      .toContain('How to pay');
  });

  it('shows no accept/decline block — an invoice is not a decision', () => {
    const html = invoice();
    expect(html).not.toContain('action=accept');
    expect(html).not.toContain('Decline quote');
  });

  it('credits a paid deposit against the balance', () => {
    const html = invoice({ depositCredit: 2029.64, total: 6088.91 });
    expect(html).toContain('Deposit already paid');
    expect(html).toContain('−$2,029.64');
    expect(html).toContain('Balance Due');
  });
});

describe('quote reminder email', () => {
  it('reuses the same accept/decline block as the original quote', () => {
    const html = buildQuoteReminderEmailHtml({
      customerName: 'Sarah',
      jobName: 'Colorbond fence',
      total: 8118.55,
      acceptanceUrl: ACCEPTANCE_URL,
      followUpNumber: 1,
      business,
    });
    expect(html).toContain('token=abc123&amp;action=accept');
    expect(html).toContain('token=abc123&amp;action=decline');
    expect(html).toContain('Review &amp; accept quote');
    expect(html).toContain('$8,118.55');
  });

  it('escapes the job name', () => {
    const html = buildQuoteReminderEmailHtml({
      customerName: 'Sarah',
      jobName: '<script>alert(1)</script>',
      total: 100,
      acceptanceUrl: ACCEPTANCE_URL,
      followUpNumber: 2,
      business,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('generateConfirmationPage', () => {
  it('escapes a business name coming out of Firestore', () => {
    const html = generateConfirmationPage(
      'accepted',
      'Thank you!',
      '<script>alert(1)</script>',
      null,
      'https://x.test/logo.png"onerror="alert(1)',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('"onerror="alert(1)');
  });

  it('drops an unfetchable logo instead of printing a broken image', () => {
    const html = generateConfirmationPage(
      'accepted', 'Thanks!', 'Hansen Fencing', null, 'file:///var/mobile/logo.png',
    );
    expect(html).not.toContain('file:///var/mobile/logo.png');
    expect(html).not.toContain('<img');
  });

  it('escapes the message body', () => {
    const html = generateConfirmationPage('already', 'This quote has already been <b>accepted</b>.');
    expect(html).not.toContain('<b>accepted</b>');
  });

  it('falls back to the same brand colour as the email', () => {
    expect(generateConfirmationPage('accepted', 'Thanks!')).toContain('#059669');
  });

  it('honours the business brand colour when set', () => {
    expect(generateConfirmationPage('accepted', 'Thanks!', 'Hansen Fencing', '#1d4ed8'))
      .toContain('#1d4ed8');
  });

  it('shows the deposit CTA with formatted money on acceptance', () => {
    const html = generateConfirmationPage(
      'accepted', 'Thanks!', 'Hansen Fencing', null, null,
      { url: 'https://square.link/u/demo', amount: 2029.64 },
    );
    expect(html).toContain('$2,029.64');
    expect(html).toContain('https://square.link/u/demo');
  });

  it('never shows a deposit CTA on a decline', () => {
    const html = generateConfirmationPage(
      'declined', 'Recorded.', 'Hansen Fencing', null, null,
      { url: 'https://square.link/u/demo', amount: 2029.64 },
    );
    expect(html).not.toContain('https://square.link/u/demo');
  });

  it('tells the customer what happens next', () => {
    expect(generateConfirmationPage('accepted', 'Thanks!', 'Hansen Fencing'))
      .toContain('Hansen Fencing will be in touch');
  });
});
