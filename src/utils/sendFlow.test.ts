/**
 * Rules behind the two send-flow decisions the Jul 2026 audit turned up:
 * whether we still need to ask HOW to send (we don't, when there's an
 * address on file), and whether a send actually reached a customer.
 */
import { describe, it, expect } from 'vitest';

import { hasCustomerEmail, isEmailAddress, isSelfSend } from './sendFlow';

describe('hasCustomerEmail', () => {
  it('is true for a doc carrying a usable address', () => {
    expect(hasCustomerEmail({ customerEmail: 'sam@example.com' })).toBe(true);
  });

  it('is false when the field is missing or blank', () => {
    expect(hasCustomerEmail({})).toBe(false);
    expect(hasCustomerEmail({ customerEmail: '' })).toBe(false);
    expect(hasCustomerEmail({ customerEmail: '   ' })).toBe(false);
  });

  it('is false for junk that would never deliver — the sheet stays the entry point', () => {
    expect(hasCustomerEmail({ customerEmail: 'sam' })).toBe(false);
    expect(hasCustomerEmail({ customerEmail: 'sam@example' })).toBe(false);
    expect(hasCustomerEmail({ customerEmail: '0412 345 678' })).toBe(false);
  });

  it('tolerates surrounding whitespace on a real address', () => {
    expect(hasCustomerEmail({ customerEmail: '  sam@example.com ' })).toBe(true);
  });
});

describe('isEmailAddress', () => {
  it('rejects nullish input without throwing', () => {
    expect(isEmailAddress(undefined)).toBe(false);
    expect(isEmailAddress(null)).toBe(false);
  });

  it('accepts a plain address', () => {
    expect(isEmailAddress('jo@trade.com.au')).toBe(true);
  });
});

describe('isSelfSend', () => {
  it('flags a send to the tradie’s own account email', () => {
    expect(isSelfSend('jo@trade.com.au', 'jo@trade.com.au')).toBe(true);
  });

  it('ignores case and whitespace', () => {
    expect(isSelfSend('  Jo@Trade.com.AU ', 'jo@trade.com.au')).toBe(true);
  });

  it('is false for a real customer', () => {
    expect(isSelfSend('sam@example.com', 'jo@trade.com.au')).toBe(false);
  });

  it('is false when either side is missing — never guess a self-send', () => {
    expect(isSelfSend('', 'jo@trade.com.au')).toBe(false);
    expect(isSelfSend('sam@example.com', '')).toBe(false);
    expect(isSelfSend('sam@example.com', undefined)).toBe(false);
  });
});
