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
import { classifyUnsendable, hasHardBounce } from './email';

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
