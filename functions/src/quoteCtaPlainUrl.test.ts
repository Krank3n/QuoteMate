/**
 * The quote email must show the real acceptance address in plain text.
 *
 * Brevo rewrites every `href` to https://<sub>.r.bh.d.sendibt3.com/tr/cl/<hash>
 * and offers no per-message opt-out for transactional mail — `clicktracking="off"`
 * is a Mailchimp convention Brevo ignores (shipped and reverted 18-19 Aug 2026).
 * So the buttons cannot show our domain, and a self-hosted redirect wouldn't
 * help either: a probe confirmed Brevo rewrites hrefs pointing at
 * quotemateapp.au exactly the same way.
 *
 * What survives is a bare URL sitting in the body as TEXT — verified by
 * sending a probe through Brevo and reading the delivered message. That gives
 * the customer one legible, unrewritten address to read, type, or check the
 * button against.
 *
 * Measured on a real tradie's account, 18 Aug 2026:
 *   $31,737 quote  opened ELEVEN times, zero clicks
 *   $44,304 quote  opened once,          zero clicks
 *   $24,040 quote  ONE click          -> accepted two days later
 */
import { describe, it, expect } from 'vitest';

import { renderQuoteCta } from './email';

const ACCEPT_URL = 'https://quotemateapp.au/q?token=abc123';
const render = (over: Record<string, unknown> = {}) =>
  renderQuoteCta({ acceptanceUrl: ACCEPT_URL, accent: '#059669', businessName: 'Bribie Island Cabinetmakers', ...over } as any);

/** The block with every anchor stripped — i.e. what Brevo leaves alone. */
const textOnly = (html: string) => html.replace(/<a\b[\s\S]*?<\/a>/g, '');

describe('quote email — plain-text acceptance address', () => {
  it('prints the real URL outside any anchor, so Brevo cannot rewrite it', () => {
    expect(textOnly(render())).toContain(ACCEPT_URL);
  });

  it('never wraps that URL in a link — one <a> and it is rewritten again', () => {
    const html = render();
    const anchored = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || [];
    for (const a of anchored) expect(a).not.toContain('Rather type it in');
    // The address must appear in the body text, not only inside a button.
    expect(textOnly(html)).toMatch(/quotemateapp\.au\/q\?token=abc123/);
  });

  it('still shows the address on the deposit variant, where the money is largest', () => {
    const html = render({
      depositPayNowUrl: 'https://squareup.com/checkout/xyz',
      depositAmount: 5000,
      depositPercentage: 20,
    });
    // The primary button goes to Square, but the address a customer verifies
    // must still be OUR acceptance page.
    expect(textOnly(html)).toContain(ACCEPT_URL);
  });

  it('carries through to the reminder email that reuses the block', () => {
    expect(textOnly(render({ heading: 'Still keen?' }))).toContain(ACCEPT_URL);
  });

  it('escapes the URL rather than interpolating it raw', () => {
    const html = renderQuoteCta({
      acceptanceUrl: 'https://quotemateapp.au/q?token=a"><script>x</script>',
      accent: '#059669',
    } as any);
    expect(html).not.toContain('<script>');
  });

  it('renders nothing extra when there is no acceptance URL to show', () => {
    const html = renderQuoteCta({ accent: '#059669' } as any);
    expect(html).not.toContain('Rather type it in');
  });
});
