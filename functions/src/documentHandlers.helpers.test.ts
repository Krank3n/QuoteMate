import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  buildSelfCopyBcc,
  buildQuotePdfHtmlForQuote,
  sendMethodPatch,
  stageTransitionTimestamps,
} from './documentHandlers';

describe('sendMethodPatch', () => {
  it('returns {sendMethod} only on a sent transition', () => {
    const transitions = stageTransitionTimestamps('draft', 'quote_sent');
    expect(transitions.sentAt).toBeTypeOf('number');
    expect(sendMethodPatch(transitions, 'email')).toEqual({ sendMethod: 'email' });

    const invoiceTransitions = stageTransitionTimestamps('quote_accepted', 'invoice_sent');
    expect(invoiceTransitions.sentAt).toBeTypeOf('number');
    expect(sendMethodPatch(invoiceTransitions, 'sms')).toEqual({ sendMethod: 'sms' });
  });

  it('returns {} on a self-transition', () => {
    // Self-transition yields no sentAt, so nothing to pair a method with.
    const transitions = stageTransitionTimestamps('quote_sent', 'quote_sent');
    expect(transitions.sentAt).toBeUndefined();
    expect(sendMethodPatch(transitions, 'email')).toEqual({});
  });

  it('returns {} for a non-sent target', () => {
    const transitions = stageTransitionTimestamps('quote_sent', 'quote_accepted');
    expect(transitions.sentAt).toBeUndefined();
    expect(sendMethodPatch(transitions, 'email')).toEqual({});
  });

  it('returns {} when no sendMethod supplied on a sent transition', () => {
    const transitions = stageTransitionTimestamps('draft', 'quote_sent');
    expect(sendMethodPatch(transitions, undefined)).toEqual({});
  });
});

describe('buildSelfCopyBcc', () => {
  const base = { sendCopyToSelf: true, isTestSend: false, selfEmail: 'tradie@example.au', recipientEmail: 'client@example.au' };

  it('BCCs the tradie on a real send with the toggle on', () => {
    expect(buildSelfCopyBcc(base)).toEqual([{ email: 'tradie@example.au' }]);
  });

  it('returns undefined when the toggle is off', () => {
    expect(buildSelfCopyBcc({ ...base, sendCopyToSelf: false })).toBeUndefined();
    expect(buildSelfCopyBcc({ ...base, sendCopyToSelf: undefined })).toBeUndefined();
  });

  it('returns undefined on test sends (they already go to the tradie)', () => {
    expect(buildSelfCopyBcc({ ...base, isTestSend: true })).toBeUndefined();
  });

  it('returns undefined when no account email could be resolved', () => {
    expect(buildSelfCopyBcc({ ...base, selfEmail: null })).toBeUndefined();
    expect(buildSelfCopyBcc({ ...base, selfEmail: '' })).toBeUndefined();
  });

  it('skips the BCC when the tradie is already the recipient (case/whitespace-insensitive)', () => {
    expect(buildSelfCopyBcc({ ...base, recipientEmail: 'tradie@example.au' })).toBeUndefined();
    expect(buildSelfCopyBcc({ ...base, recipientEmail: '  Tradie@Example.AU ' })).toBeUndefined();
  });
});

/**
 * Regression: "Invalid Date" on the customer-facing quote PDF.
 *
 * `quoteDate` is built from `quote.documentDate || quote.updatedAt`, read
 * straight off Firestore. When that field is a Timestamp (32 of 400 sampled
 * prod quotes), the old `new Date(value)` produced Invalid Date and the
 * customer's PDF showed the literal text "Invalid Date" under the quote
 * number. Assert on the rendered HTML, not just the formatter, so the whole
 * path is covered.
 */
describe('buildQuotePdfHtmlForQuote — quote date', () => {
  const AT_NOON_UTC = Date.UTC(2026, 7, 9, 12, 0, 0); // 9 Aug 2026
  const business = { businessName: 'Riverbend Carpentry' } as any;
  const baseQuote = {
    customerName: 'Test Client',
    quoteNumber: 'QU-1189',
    job: { name: 'Sleeper retaining wall', description: 'Test' },
    materials: [], subtotal: 0, total: 0,
  };

  it('renders a real date when updatedAt is a Firestore Timestamp — THE BUG', () => {
    const html = buildQuotePdfHtmlForQuote(
      { ...baseQuote, updatedAt: { toDate: () => new Date(AT_NOON_UTC) } },
      business,
    );
    expect(html).not.toContain('Invalid Date');
    expect(html).toContain('09 August 2026');
  });

  it('renders a real date for {_seconds} and epoch-millis shapes too', () => {
    for (const updatedAt of [{ _seconds: AT_NOON_UTC / 1000, _nanoseconds: 0 }, AT_NOON_UTC]) {
      const html = buildQuotePdfHtmlForQuote({ ...baseQuote, updatedAt }, business);
      expect(html).not.toContain('Invalid Date');
      expect(html).toContain('09 August 2026');
    }
  });

  it('lets a backdated documentDate win over updatedAt', () => {
    const html = buildQuotePdfHtmlForQuote(
      {
        ...baseQuote,
        documentDate: Date.UTC(2026, 0, 15, 12, 0, 0),
        updatedAt: { toDate: () => new Date(AT_NOON_UTC) },
      },
      business,
    );
    expect(html).toContain('15 January 2026');
    expect(html).not.toContain('09 August 2026');
  });
});

/**
 * The quote send is only reachable with the admin SDK, so the one rule that
 * has to hold at that call site — a send BCC'd back to the tradie carries no
 * pixel, because that copy is the SAME html and the tradie opening it would
 * be recorded as the customer opening theirs — is pinned by reading the
 * source. shouldEmbedEmailOpenPixel itself is unit-tested in
 * emailOpenPixel.test.ts.
 */
describe('quote send — email-open pixel gating', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'documentHandlers.ts'), 'utf8');

  it('decides the pixel through shouldEmbedEmailOpenPixel, passing the self-copy flag', () => {
    expect(src).toContain(
      'shouldEmbedEmailOpenPixel({ isTestSend, sendCopyToSelf: input.sendCopyToSelf })',
    );
  });

  it('mints the open token only inside that gate — no token doc on a self-copy or test send', () => {
    const gateIdx = src.indexOf('shouldEmbedEmailOpenPixel({');
    const mintIdx = src.indexOf('input.generateEmailOpenToken()');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(mintIdx).toBeGreaterThan(gateIdx);
    // Exactly one mint site, and one emailOpenTokens write, both in the gate.
    expect(src.match(/input\.generateEmailOpenToken\(\)/g)).toHaveLength(1);
    expect(src.match(/emailOpenTokens\//g)).toHaveLength(1);
  });
});
