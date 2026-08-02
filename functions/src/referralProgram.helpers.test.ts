import { describe, it, expect } from 'vitest';
import {
  billingPeriodFor,
  buildReferralCode,
  calculateCommission,
  clampCommissionRate,
  earningDocId,
  evaluateApplyCode,
  isValidReferralCode,
  normaliseReferralCode,
  projectedCommissionPerUserCents,
  reconcilePayout,
  REFERRAL_ATTRIBUTION_WINDOW_MS,
} from './referralProgram.helpers';

const NOW = new Date('2026-08-15T02:00:00Z').getTime();

describe('normaliseReferralCode / isValidReferralCode', () => {
  it('upper-cases and trims a well-formed code', () => {
    expect(normaliseReferralCode('  qm-ab2cd3 ')).toBe('QM-AB2CD3');
    expect(isValidReferralCode('QM-AB2CD3')).toBe(true);
  });

  it('strips path separators so a code can never address another document', () => {
    // The old code interpolated raw input into `referrals/${code}`, so a value
    // containing `/` addressed a different (possibly deeper) document.
    for (const attack of ['QM-AB2CD3/../../users/victim', '../../users/victim', 'QM-AB2CD3/child/doc']) {
      const normalised = normaliseReferralCode(attack);
      expect(normalised).not.toContain('/');
      expect(normalised).not.toContain('.');
      expect(isValidReferralCode(normalised)).toBe(false);
    }
  });

  it('length-caps the candidate so an oversized payload cannot be echoed back', () => {
    expect(normaliseReferralCode('Q'.repeat(500)).length).toBe(16);
  });

  it('rejects ambiguous characters excluded from the alphabet', () => {
    for (const bad of ['QM-ABICD3', 'QM-ABOCD3', 'QM-AB0CD3', 'QM-AB1CD3']) {
      expect(isValidReferralCode(bad)).toBe(false);
    }
  });

  it('rejects wrong length, missing prefix, and non-strings', () => {
    expect(isValidReferralCode('QM-AB2CD')).toBe(false);
    expect(isValidReferralCode('QM-AB2CD34')).toBe(false);
    expect(isValidReferralCode('AB2CD3')).toBe(false);
    expect(normaliseReferralCode(null)).toBe('');
    expect(normaliseReferralCode(42)).toBe('');
  });

  it('always generates a code that passes its own validator', () => {
    let seed = 0;
    const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 200; i++) {
      expect(isValidReferralCode(buildReferralCode(random))).toBe(true);
    }
  });
});

describe('billingPeriodFor', () => {
  it('buckets by the billing timezone, not UTC', () => {
    // 1 Sep 2026 09:00 AEST === 31 Aug 2026 23:00 UTC. A UTC bucket would call
    // this "2026-08" and let the September renewal be recorded twice.
    const payment = new Date('2026-08-31T23:00:00Z');
    expect(billingPeriodFor(payment)).toBe('2026-09');
  });

  it('pads single-digit months', () => {
    expect(billingPeriodFor(new Date('2026-03-15T02:00:00Z'))).toBe('2026-03');
  });
});

describe('earningDocId', () => {
  it('is deterministic per referred user + period so a webhook retry cannot double-pay', () => {
    expect(earningDocId('uid1', '2026-08')).toBe(earningDocId('uid1', '2026-08'));
    expect(earningDocId('uid1', '2026-08')).not.toBe(earningDocId('uid1', '2026-09'));
    expect(earningDocId('uid1', '2026-08')).not.toBe(earningDocId('uid2', '2026-08'));
  });
});

describe('calculateCommission', () => {
  it('takes Apple\'s 30% off the top before the affiliate share', () => {
    // $49.00 iOS: Apple 30% => net $34.30, 50% => $17.15
    expect(calculateCommission('ios', 4900, 0.5)).toEqual({
      platformFee: 1470,
      netRevenue: 3430,
      commissionAmount: 1715,
    });
  });

  it('uses the Google 15% rate on Android', () => {
    expect(calculateCommission('android', 4900, 0.5)).toEqual({
      platformFee: 735,
      netRevenue: 4165,
      commissionAmount: 2083,
    });
  });

  it('applies Stripe percentage + fixed fee on web', () => {
    expect(calculateCommission('web', 4900, 0.5)).toEqual({
      platformFee: 172,
      netRevenue: 4728,
      commissionAmount: 2364,
    });
  });

  it('falls back to the web fee table for an unknown platform', () => {
    expect(calculateCommission('carrier-billing', 4900, 0.5)).toEqual(
      calculateCommission('web', 4900, 0.5)
    );
  });

  it('never produces a negative fee/net/commission for a tiny proration', () => {
    const result = calculateCommission('web', 10, 0.5);
    expect(result.platformFee).toBeLessThanOrEqual(10);
    expect(result.netRevenue).toBeGreaterThanOrEqual(0);
    expect(result.commissionAmount).toBeGreaterThanOrEqual(0);
  });

  it('treats a zero or negative gross as no revenue (trialing / $0 invoice)', () => {
    expect(calculateCommission('ios', 0, 0.5).commissionAmount).toBe(0);
    expect(calculateCommission('ios', -4900, 0.5).commissionAmount).toBe(0);
  });

  it('clamps an out-of-range commission rate instead of over-paying', () => {
    expect(clampCommissionRate(2.5)).toBe(1);
    expect(clampCommissionRate(-1)).toBe(0);
    expect(clampCommissionRate(undefined)).toBe(0.5);
    expect(clampCommissionRate(NaN)).toBe(0.5);
    // A corrupted 500% rate must not pay more than the net revenue.
    const r = calculateCommission('web', 4900, 5);
    expect(r.commissionAmount).toBe(r.netRevenue);
  });
});

describe('evaluateApplyCode', () => {
  const base = {
    code: 'QM-AB2CD3',
    referrerUserId: 'referrer',
    selfUid: 'newbie',
    existingReferredBy: null,
    alreadySubscribed: false,
    accountCreatedAtMs: NOW - 1000,
    nowMs: NOW,
  };

  it('accepts a fresh, unsubscribed, unreferred account', () => {
    expect(evaluateApplyCode(base)).toEqual({ ok: true });
  });

  it('rejects a malformed code before any lookup result is trusted', () => {
    expect(evaluateApplyCode({ ...base, code: 'nope' })).toEqual({ ok: false, reason: 'invalid_format' });
  });

  it('rejects an unknown code', () => {
    expect(evaluateApplyCode({ ...base, referrerUserId: null })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects self-referral', () => {
    expect(evaluateApplyCode({ ...base, referrerUserId: 'newbie' })).toEqual({ ok: false, reason: 'self_referral' });
  });

  it('rejects re-attribution once a referrer is set', () => {
    expect(evaluateApplyCode({ ...base, existingReferredBy: 'someone' })).toEqual({
      ok: false,
      reason: 'already_referred',
    });
  });

  it('rejects an already-paying user — the affiliate did not acquire them', () => {
    expect(evaluateApplyCode({ ...base, alreadySubscribed: true })).toEqual({
      ok: false,
      reason: 'already_subscribed',
    });
  });

  it('rejects an account older than the attribution window', () => {
    expect(
      evaluateApplyCode({ ...base, accountCreatedAtMs: NOW - REFERRAL_ATTRIBUTION_WINDOW_MS - 1 })
    ).toEqual({ ok: false, reason: 'window_expired' });
  });

  it('allows an account exactly at the window edge', () => {
    expect(evaluateApplyCode({ ...base, accountCreatedAtMs: NOW - REFERRAL_ATTRIBUTION_WINDOW_MS })).toEqual({
      ok: true,
    });
  });

  it('does not apply the window when the creation time is unknown', () => {
    expect(evaluateApplyCode({ ...base, accountCreatedAtMs: null })).toEqual({ ok: true });
  });
});

describe('reconcilePayout', () => {
  it('derives the payout amount from the earning docs, not a typed number', () => {
    expect(
      reconcilePayout([
        { id: 'a', commissionAmount: 1715 },
        { id: 'b', commissionAmount: 2083 },
      ])
    ).toEqual({ earningIds: ['a', 'b'], amountCents: 3798 });
  });

  it('skips malformed/zero earnings so the ledger cannot drift', () => {
    expect(
      reconcilePayout([
        { id: 'a', commissionAmount: 1000 },
        { id: 'bad', commissionAmount: 'lots' },
        { id: 'zero', commissionAmount: 0 },
        { id: 'missing' },
      ])
    ).toEqual({ earningIds: ['a'], amountCents: 1000 });
  });

  it('returns an empty reconciliation when nothing is pending', () => {
    expect(reconcilePayout([])).toEqual({ earningIds: [], amountCents: 0 });
  });
});

describe('projectedCommissionPerUserCents', () => {
  it('is platform-specific so iOS affiliates are not shown a web-sized number', () => {
    const ios = projectedCommissionPerUserCents('ios', 4900, 0.5);
    const web = projectedCommissionPerUserCents('web', 4900, 0.5);
    expect(ios).toBe(1715);
    expect(web).toBe(2364);
    expect(ios).toBeLessThan(web);
  });
});
