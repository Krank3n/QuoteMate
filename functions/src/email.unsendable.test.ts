/**
 * Regression tests for the unsendable-address gate.
 *
 * The Aug 2026 emailLog audit found the blanket privaterelay.appleid.com ban
 * muting 50 real Sign-in-with-Apple users from every lifecycle email, while
 * 57 of 77 actually-attempted relay sends had delivered (the sender domain
 * carries Apple's relay SPF include). The ban is replaced by per-address
 * hard-bounce suppression so only individually revoked relays stay dark.
 */
import { describe, it, expect } from 'vitest';
import { classifyUnsendable, hasHardBounce, partitionRecipients } from './email';

describe('classifyUnsendable', () => {
  it('lets Apple private relay addresses through (the 50-muted-users regression)', () => {
    expect(classifyUnsendable('x9zk2@privaterelay.appleid.com')).toBeNull();
  });

  it('still blocks RFC 2606 and known-junk domains', () => {
    expect(classifyUnsendable('a@example.com')).toBe('unsendable-domain:example.com');
    expect(classifyUnsendable('a@test.com')).toBe('unsendable-domain:test.com');
    expect(classifyUnsendable('a@sentry-next.wixpress.com')).toBe('unsendable-domain:sentry-next.wixpress.com');
  });

  it('still blocks asset-filename "addresses" and invalid formats', () => {
    expect(classifyUnsendable('flags@2x.webp')).toBe('asset-filename');
    expect(classifyUnsendable('not-an-email')).toBe('invalid-format');
    expect(classifyUnsendable('')).toBe('invalid-format');
  });

  it('passes normal addresses', () => {
    expect(classifyUnsendable('tradie@gmail.com')).toBeNull();
  });
});

describe('hasHardBounce', () => {
  it('suppresses an address with a hard bounce on record (revoked relay)', () => {
    expect(hasHardBounce([{ bounceType: 'hard' }])).toBe(true);
    expect(hasHardBounce([{}, { bounceType: 'soft' }, { bounceType: 'hard' }])).toBe(true);
  });

  it('does not suppress soft bounces — full mailboxes recover', () => {
    expect(hasHardBounce([{ bounceType: 'soft' }])).toBe(false);
  });

  it('does not suppress addresses with no bounce history', () => {
    expect(hasHardBounce([])).toBe(false);
    expect(hasHardBounce([{}, { bounceType: undefined }])).toBe(false);
  });
});

// A quote can now go to several addresses at once. Each is judged on its own
// so one junk or dead address does not stop the others getting the quote.
describe('partitionRecipients', () => {
  it('keeps a plain single address', () => {
    expect(partitionRecipients('tradie@gmail.com')).toEqual({ sendable: ['tradie@gmail.com'], dropped: [] });
  });

  it('drops only the unsendable entries from a list and says why', () => {
    expect(partitionRecipients(['ceo@firm.com', 'a@example.com', 'flags@2x.webp'])).toEqual({
      sendable: ['ceo@firm.com'],
      dropped: [
        { email: 'a@example.com', reason: 'unsendable-domain:example.com' },
        { email: 'flags@2x.webp', reason: 'asset-filename' },
      ],
    });
  });

  it('drops an address with a hard bounce on record and keeps the rest', () => {
    const bounced = new Set(['dead@firm.com']);
    expect(partitionRecipients(['ceo@firm.com', 'Dead@Firm.com'], bounced)).toEqual({
      sendable: ['ceo@firm.com'],
      dropped: [{ email: 'Dead@Firm.com', reason: 'hard-bounced' }],
    });
  });

  it('ignores blanks and case-duplicates', () => {
    expect(partitionRecipients(['ceo@firm.com', '', ' CEO@firm.com ']).sendable).toEqual(['ceo@firm.com']);
  });
});
