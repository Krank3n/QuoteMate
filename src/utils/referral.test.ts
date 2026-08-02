import { describe, it, expect } from 'vitest';
import {
  applyCodeEligibility,
  buildShareMessage,
  buildSharePayload,
  commissionPerUserCents,
  displayCommissionRate,
  earningsProjection,
  extractReferralCode,
  formatCents,
  isValidReferralCode,
  MONTHLY_PRICE_CENTS,
  normaliseReferralCode,
  referralLink,
  REFERRAL_PLATFORM_FEES,
} from './referral';
import type { ReferralInfo } from '../types';

function info(overrides: Partial<ReferralInfo> = {}): ReferralInfo {
  return {
    referralCode: 'QM-AB2CD3',
    referredBy: null,
    totalReferrals: 0,
    convertedReferrals: 0,
    isAffiliate: false,
    commissionRate: 0,
    totalEarnings: 0,
    pendingEarnings: 0,
    paidEarnings: 0,
    lastPayoutAt: null,
    ...overrides,
  };
}

describe('cross-package mirrors (functions/src/referralProgram.helpers.ts)', () => {
  it('pins the platform fee table', () => {
    expect(REFERRAL_PLATFORM_FEES).toEqual({
      ios: { percentage: 0.30, fixedCents: 0 },
      android: { percentage: 0.15, fixedCents: 0 },
      web: { percentage: 0.029, fixedCents: 30 },
    });
  });

  it('pins the monthly price used for projections ($49 AUD)', () => {
    expect(MONTHLY_PRICE_CENTS).toBe(4900);
  });
});

describe('normaliseReferralCode / isValidReferralCode', () => {
  it('normalises case and whitespace', () => {
    expect(normaliseReferralCode(' qm-ab2cd3 ')).toBe('QM-AB2CD3');
    expect(isValidReferralCode('QM-AB2CD3')).toBe(true);
  });

  it('rejects the ambiguous characters excluded from the alphabet', () => {
    expect(isValidReferralCode('QM-AB0CD3')).toBe(false);
    expect(isValidReferralCode('QM-ABICD3')).toBe(false);
  });

  it('strips characters that could escape a document path', () => {
    expect(normaliseReferralCode('QM-AB2CD3/../x')).not.toContain('/');
  });

  it('handles null/undefined input', () => {
    expect(normaliseReferralCode(null)).toBe('');
    expect(normaliseReferralCode(undefined)).toBe('');
  });
});

describe('extractReferralCode', () => {
  it('pulls the code out of a pasted referral link', () => {
    expect(extractReferralCode('https://quotemateapp.au/ref/QM-AB2CD3')).toBe('QM-AB2CD3');
    expect(extractReferralCode('https://quotemateapp.au/ref/QM-AB2CD3/')).toBe('QM-AB2CD3');
    expect(extractReferralCode('check this out https://quotemateapp.au/ref/qm-ab2cd3?utm=x')).toBe('QM-AB2CD3');
  });

  it('still accepts a bare code', () => {
    expect(extractReferralCode('qm-ab2cd3')).toBe('QM-AB2CD3');
  });

  it('returns empty for junk', () => {
    expect(extractReferralCode('')).toBe('');
    expect(extractReferralCode(null)).toBe('');
  });
});

describe('commissionPerUserCents', () => {
  it('accounts for Apple\'s 30% before the affiliate share', () => {
    // $49 - 30% = $34.30 net, 50% => $17.15
    expect(commissionPerUserCents('ios', 0.5)).toBe(1715);
  });

  it('accounts for Google\'s 15%', () => {
    expect(commissionPerUserCents('android', 0.5)).toBe(2083);
  });

  it('accounts for Stripe percentage + fixed fee on web', () => {
    expect(commissionPerUserCents('web', 0.5)).toBe(2364);
  });

  it('never over-pays on a corrupted rate', () => {
    expect(commissionPerUserCents('ios', 5)).toBe(3430); // capped at 100% of net
    expect(commissionPerUserCents('ios', -1)).toBe(0);
    expect(commissionPerUserCents('ios', NaN)).toBe(0);
  });
});

describe('displayCommissionRate', () => {
  it('is null for a non-affiliate — no invented default cut', () => {
    // Regression: the screen defaulted to 80% (and the chart to 50%) whenever
    // commissionRate was falsy, showing a cut to users who had none.
    expect(displayCommissionRate(info())).toBeNull();
    expect(displayCommissionRate(null)).toBeNull();
  });

  it('is null for a revoked affiliate left on rate 0', () => {
    expect(displayCommissionRate(info({ isAffiliate: true, commissionRate: 0 }))).toBeNull();
  });

  it('returns the real rate for an enabled affiliate', () => {
    expect(displayCommissionRate(info({ isAffiliate: true, commissionRate: 0.5 }))).toBe(0.5);
  });

  it('clamps a corrupted rate to 100%', () => {
    expect(displayCommissionRate(info({ isAffiliate: true, commissionRate: 4 }))).toBe(1);
  });
});

describe('earningsProjection', () => {
  it('is empty when there is no genuine rate — no fabricated income claim', () => {
    expect(earningsProjection(info())).toEqual([]);
    expect(earningsProjection(info({ isAffiliate: true, commissionRate: 0 }))).toEqual([]);
    expect(earningsProjection(null)).toEqual([]);
  });

  it('projects from the real rate using the conservative (iOS) fee', () => {
    const rows = earningsProjection(info({ isAffiliate: true, commissionRate: 0.5 }));
    expect(rows).toEqual([
      { users: 5, amountCents: 8575 },
      { users: 10, amountCents: 17150 },
      { users: 25, amountCents: 42875 },
      { users: 50, amountCents: 85750 },
      { users: 100, amountCents: 171500 },
    ]);
  });

  it('never projects above the platform-adjusted ceiling', () => {
    const rows = earningsProjection(info({ isAffiliate: true, commissionRate: 1 }));
    // 100% of iOS net ($34.30) per user, never the full $49 gross.
    expect(rows[0].amountCents).toBe(5 * 3430);
  });
});

describe('applyCodeEligibility', () => {
  it('allows a fresh free user to apply a code', () => {
    expect(applyCodeEligibility(info(), false)).toEqual({ canApply: true });
  });

  it('blocks a user who already has a referrer', () => {
    expect(applyCodeEligibility(info({ referredBy: 'someone' }), false)).toEqual({
      canApply: false,
      reason: 'already_referred',
    });
  });

  it('blocks a Pro user — the server rejects it, so do not show the form', () => {
    expect(applyCodeEligibility(info(), true)).toEqual({
      canApply: false,
      reason: 'already_subscribed',
    });
  });
});

describe('share copy (App Store Guideline 3.1.1)', () => {
  const link = referralLink('QM-AB2CD3');

  it('builds the canonical link', () => {
    expect(link).toBe('https://quotemateapp.au/ref/QM-AB2CD3');
  });

  it('promises the recipient nothing a code cannot deliver', () => {
    const message = buildShareMessage('QM-AB2CD3', link);
    for (const forbidden of ['free month', 'discount', '% off', 'unlock', 'credit', 'reward', 'bonus']) {
      expect(message.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('includes both the link and the code', () => {
    const message = buildShareMessage('QM-AB2CD3', link);
    expect(message).toContain(link);
    expect(message).toContain('QM-AB2CD3');
  });

  it('passes the URL separately on iOS so Messages renders a real link', () => {
    const ios = buildSharePayload('QM-AB2CD3', link, 'ios');
    expect(ios.url).toBe(link);
    const android = buildSharePayload('QM-AB2CD3', link, 'android');
    expect(android.url).toBeUndefined();
    expect(android.message).toContain(link);
  });
});

describe('formatCents', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(1715)).toBe('$17.15');
    expect(formatCents(0)).toBe('$0.00');
  });

  it('tolerates junk instead of rendering "$NaN"', () => {
    expect(formatCents(NaN)).toBe('$0.00');
    expect(formatCents(undefined as unknown as number)).toBe('$0.00');
  });
});
