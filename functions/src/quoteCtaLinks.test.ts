/**
 * The quote email's decision buttons must keep their real destination.
 *
 * Brevo rewrites every href in a transactional email to
 * https://<sub>.r.bh.d.sendibt3.com/tr/cl/<hash> unless the anchor opts out
 * with clicktracking="off". That turned "Accept quote" — the one link in the
 * email asking someone to commit to thousands of dollars — into an opaque
 * third-party redirect, indistinguishable from phishing to anyone who checks
 * a link before clicking it.
 *
 * Measured 18 Aug 2026 on a real tradie's account:
 *   $31,737 quote — delivered, opened ELEVEN times, zero clicks
 *   $44,304 quote — delivered, opened once,          zero clicks
 *   $24,040 quote — delivered, opened, ONE click  -> accepted two days later
 *
 * The quote PDF is attached, so a customer can read the lot without ever
 * following the link. That leaves the tracking domain as the last thing
 * standing between them and accepting.
 */
import { describe, it, expect } from 'vitest';

import { renderQuoteCta } from './email';

const ACCEPT_URL = 'https://quotemateapp.au/q?token=abc123';
const render = (over: Record<string, unknown> = {}) =>
  renderQuoteCta({ acceptanceUrl: ACCEPT_URL, accent: '#059669', businessName: 'Bribie Island Cabinetmakers', ...over } as any);

/** Every anchor in the block, with its attributes. */
const anchors = (html: string) => html.match(/<a\b[^>]*>/g) || [];

describe('quote email decision buttons', () => {
  it('opts every decision button out of link rewriting', () => {
    const found = anchors(render());
    expect(found.length).toBeGreaterThan(0);
    for (const a of found) expect(a).toContain('clicktracking="off"');
  });

  it('points Accept at the acceptance URL itself, not a redirect', () => {
    const html = render();
    expect(html).toContain(ACCEPT_URL);
    expect(html).not.toMatch(/sendibt3\.com/);
  });

  it('covers Decline too — a customer must be able to say no', () => {
    const html = render();
    expect(html).toContain('Decline quote');
    const decline = anchors(html).find((a) => a.includes('action=decline'));
    expect(decline).toBeDefined();
    expect(decline).toContain('clicktracking="off"');
  });

  it('keeps the opt-out on the deposit variant, where the money is largest', () => {
    const html = render({
      depositPayNowUrl: 'https://squareup.com/checkout/xyz',
      depositAmount: 5000,
      depositPercentage: 20,
    });
    for (const a of anchors(html)) expect(a).toContain('clicktracking="off"');
  });

  it('keeps the opt-out when the reminder email reuses the block', () => {
    const html = render({ heading: 'Still keen?', primaryLabel: 'Accept quote' });
    for (const a of anchors(html)) expect(a).toContain('clicktracking="off"');
  });
});
