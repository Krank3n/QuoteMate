import { describe, it, expect } from 'vitest';
import {
  QM_APP_FEE_PCT_ONLINE,
  QM_APP_FEE_PCT_ONLINE_FREE,
  QM_APP_FEE_PCT_IN_PERSON,
} from '../../shared/pdf/squareFees';
import { PRO_FEATURES, proFeeLine, paywallSubtitle, paywallHeaderNote } from './paywallCopy';

describe('paywallCopy', () => {
  const everyLine = [
    ...PRO_FEATURES.map((f) => f.text),
    paywallSubtitle({ kind: 'pro' }),
    paywallSubtitle({ kind: 'free' }),
    paywallSubtitle({ kind: 'trial', daysRemaining: 3 }),
    paywallHeaderNote({ kind: 'trial', daysRemaining: 3 }),
    paywallHeaderNote({ kind: 'free' }),
  ].filter((s): s is string => typeof s === 'string');

  it('never carries guilt or unsupported competitor claims', () => {
    // The old rotating quips: "your competitors just upgraded", "don't say we
    // didn't warn you", "your quotes will miss you". None of that is a claim
    // we can back, and a paywall that scolds converts nobody.
    const banned = /competitor|warn|miss you|deserve|they all say|no pressure/i;
    everyLine.forEach((line) => expect(line).not.toMatch(banned));
  });

  it('never says "AI" in user-facing copy', () => {
    everyLine.forEach((line) => expect(line).not.toMatch(/\bAI\b/));
  });

  it('never suggests a free account loses quotes or invoicing', () => {
    // Free keeps unlimited quotes and Square-linked invoicing, so Pro must not
    // be sold as "unlimited quotes and invoices".
    PRO_FEATURES.forEach((f) => expect(f.text).not.toMatch(/unlimited/i));
    expect(paywallHeaderNote({ kind: 'free' })).toMatch(/still work/);
  });

  it('derives the fee line from the fee model of record', () => {
    expect(proFeeLine()).toBe(
      'Lower fee on Square payments: 1% online and 1.5% in person, instead of 1.7%'
    );
    expect(proFeeLine()).toContain(`${QM_APP_FEE_PCT_ONLINE}% online`);
    expect(proFeeLine()).toContain(`${QM_APP_FEE_PCT_IN_PERSON}% in person`);
    expect(proFeeLine()).toContain(`instead of ${QM_APP_FEE_PCT_ONLINE_FREE}%`);
  });

  it('lists the fee line among the Pro features, each with an icon', () => {
    expect(PRO_FEATURES.map((f) => f.text)).toContain(proFeeLine());
    PRO_FEATURES.forEach((f) => {
      expect(f.icon.length).toBeGreaterThan(0);
      expect(f.text.length).toBeGreaterThan(0);
    });
  });

  it('describes the plan state in the subtitle', () => {
    expect(paywallSubtitle({ kind: 'pro' })).toBe('Pro is active on this account');
    expect(paywallSubtitle({ kind: 'free' })).toBe('Your free trial has ended');
    expect(paywallSubtitle({ kind: 'trial', daysRemaining: 1 })).toBe('1 day left in your free trial');
    expect(paywallSubtitle({ kind: 'trial', daysRemaining: 0 })).toBe('0 days left in your free trial');
    expect(paywallSubtitle({ kind: 'trial', daysRemaining: 14 })).toBe('14 days left in your free trial');
  });

  it('shows a header note only to accounts that are not yet Pro', () => {
    expect(paywallHeaderNote({ kind: 'pro' })).toBeNull();
    expect(paywallHeaderNote({ kind: 'trial', daysRemaining: 5 })).toMatch(/keep it after the trial/);
    expect(paywallHeaderNote({ kind: 'free' })).toMatch(/Pro adds the rest/);
  });
});
