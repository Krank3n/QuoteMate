/**
 * Rules behind the two send-flow decisions the Jul 2026 audit turned up:
 * whether we still need to ask HOW to send (we don't, when there's an
 * address on file), and whether a send actually reached a customer.
 */
import { describe, it, expect } from 'vitest';

import {
  hasCustomerEmail,
  isEmailAddress,
  isEmailList,
  isSelfSend,
  orderSendOptions,
  splitEmailList,
} from './sendFlow';

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

describe('orderSendOptions', () => {
  it('leads with SMS for a phone-only customer', () => {
    expect(orderSendOptions({ hasEmail: false, canSms: true })).toEqual(['sms', 'email']);
  });

  it('leads with Email whenever there is an address on file', () => {
    expect(orderSendOptions({ hasEmail: true, canSms: false })).toEqual(['email', 'sms']);
    expect(orderSendOptions({ hasEmail: true, canSms: true })).toEqual(['email', 'sms']);
  });

  // Nothing to send to: the email preview lets the tradie type an address,
  // the SMS row has nowhere to send. Email keeps the lead.
  it('leads with Email when we have neither', () => {
    expect(orderSendOptions({ hasEmail: false, canSms: false })).toEqual(['email', 'sms']);
  });

  // canSms is "can this be finished", not "is there a number". On web the
  // SMS path copies the message and announces it through Alert.alert, which
  // react-native-web no-ops — so it must never be the lead row.
  it('never leads with a channel that cannot be completed', () => {
    expect(orderSendOptions({ hasEmail: false, canSms: false })).toEqual(['email', 'sms']);
  });

  it('never drops or duplicates a channel', () => {
    for (const hasEmail of [true, false]) {
      for (const canSms of [true, false]) {
        expect([...orderSendOptions({ hasEmail, canSms })].sort()).toEqual(['email', 'sms']);
      }
    }
  });
});

// Sep 2026: a Pro tradie asked for "more than 1 email addresses for clients"
// so a quote reaches the accounts desk as well as the owner. The composer's
// recipient field takes a list; this is how the list is read.
describe('splitEmailList', () => {
  it('splits on comma, semicolon, space and newline alike', () => {
    expect(splitEmailList('a@x.com, b@y.com;c@z.com d@w.com\ne@v.com')).toEqual([
      'a@x.com',
      'b@y.com',
      'c@z.com',
      'd@w.com',
      'e@v.com',
    ]);
  });

  it('lower-cases and drops duplicates that differ only by case, keeping first-seen order', () => {
    expect(splitEmailList('Accounts@Firm.com, ceo@firm.com, accounts@firm.com')).toEqual([
      'accounts@firm.com',
      'ceo@firm.com',
    ]);
  });

  it('ignores a trailing separator and surrounding whitespace', () => {
    expect(splitEmailList('  a@x.com, ')).toEqual(['a@x.com']);
    expect(splitEmailList('a@x.com,,, ;')).toEqual(['a@x.com']);
  });

  it('is empty for nothing', () => {
    expect(splitEmailList('')).toEqual([]);
    expect(splitEmailList('   ')).toEqual([]);
    expect(splitEmailList(undefined)).toEqual([]);
    expect(splitEmailList(null)).toEqual([]);
  });

  it('does not validate — a bad entry comes back for the caller to flag', () => {
    expect(splitEmailList('a@x.com, bob')).toEqual(['a@x.com', 'bob']);
  });
});

describe('isEmailList', () => {
  it('is true only when every entry is an address', () => {
    expect(isEmailList(['a@x.com', 'b@y.com.au'])).toBe(true);
    expect(isEmailList(['a@x.com', 'bob'])).toBe(false);
  });

  it('is false for an empty list — nobody to send to', () => {
    expect(isEmailList([])).toBe(false);
  });
});
