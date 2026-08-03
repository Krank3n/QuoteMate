import { describe, it, expect } from 'vitest';
import { isBilledSub, subEnvironment, deriveSubFields, resolveServerPlan, TRIAL_MS } from './subscription.helpers';

// Build a StoreKit 2-style JWS: header.payload.signature with base64url segments.
function jwsWith(payload: Record<string, any>): string {
  const b64url = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'ES256' })}.${b64url(payload)}.c2ln`;
}

describe('subEnvironment', () => {
  it('reads the environment from a StoreKit 2 JWS purchaseToken', () => {
    expect(subEnvironment({ purchaseToken: jwsWith({ environment: 'Sandbox' }) })).toBe('Sandbox');
    expect(subEnvironment({ purchaseToken: jwsWith({ environment: 'Production' }) })).toBe('Production');
  });

  it('prefers an explicit environment field over the token', () => {
    expect(
      subEnvironment({ environment: 'Production', purchaseToken: jwsWith({ environment: 'Sandbox' }) })
    ).toBe('Production');
  });

  it('returns null for legacy base64 receipts, malformed JWS, and missing tokens', () => {
    expect(subEnvironment({ purchaseToken: 'MIIEMTCCA7agAwIBAgIQR8' })).toBeNull();
    expect(subEnvironment({ purchaseToken: 'a.%%%not-base64-json%%%.c' })).toBeNull();
    expect(subEnvironment({ purchaseToken: jwsWith({ transactionId: '123' }) })).toBeNull();
    expect(subEnvironment({})).toBeNull();
    expect(subEnvironment(null)).toBeNull();
  });
});

describe('isBilledSub', () => {
  it('counts a pro sub backed by a store productId', () => {
    expect(isBilledSub({ isPro: true, platform: 'android', productId: 'quotemate_pro_yearly' })).toBe(true);
  });

  it('counts a pro sub backed by a Stripe subscriptionId or priceId', () => {
    expect(isBilledSub({ isPro: true, platform: 'web', subscriptionId: 'sub_123' })).toBe(true);
    expect(isBilledSub({ isPro: true, platform: 'web', priceId: 'price_123' })).toBe(true);
  });

  it('rejects non-pro, admin comps, and bare isPro flags without billing IDs', () => {
    expect(isBilledSub({ isPro: false, productId: 'quotemate_pro_yearly' })).toBe(false);
    expect(isBilledSub({ isPro: true, platform: 'admin_grant', productId: 'quotemate_pro_yearly' })).toBe(false);
    expect(isBilledSub({ isPro: true, platform: 'android' })).toBe(false);
    expect(isBilledSub(null)).toBe(false);
  });

  it('rejects App Store sandbox purchases even when they carry a productId', () => {
    const sandbox = {
      isPro: true,
      platform: 'ios',
      productId: 'quotemate_pro_yearly',
      purchaseToken: jwsWith({ environment: 'Sandbox', productId: 'quotemate_pro_yearly' }),
    };
    expect(isBilledSub(sandbox)).toBe(false);
  });

  it('rejects an explicit environment: Sandbox field (backfill override)', () => {
    expect(
      isBilledSub({ isPro: true, platform: 'ios', productId: 'quotemate_pro_yearly', environment: 'Sandbox' })
    ).toBe(false);
  });

  it('still counts production App Store purchases with a JWS token', () => {
    const production = {
      isPro: true,
      platform: 'ios',
      productId: 'quotemate_pro_yearly',
      purchaseToken: jwsWith({ environment: 'Production' }),
    };
    expect(isBilledSub(production)).toBe(true);
  });
});

describe('deriveSubFields billing rollup', () => {
  it('gives a sandbox sub pro tier but zero revenue', () => {
    const f = deriveSubFields({
      isPro: true,
      platform: 'ios',
      productId: 'quotemate_pro_yearly',
      purchaseToken: jwsWith({ environment: 'Sandbox' }),
    });
    expect(f.tier).toBe('pro');
    expect(f.billed).toBe(false);
    expect(f.interval).toBeNull();
    expect(f.monthlyAud).toBe(0);
  });

  it('gives a billed yearly sub the yearly monthly-equivalent revenue', () => {
    const f = deriveSubFields({ isPro: true, platform: 'android', productId: 'quotemate_pro_yearly' });
    expect(f.billed).toBe(true);
    expect(f.interval).toBe('yearly');
    expect(f.monthlyAud).toBeCloseTo(328 / 12, 1);
  });
});

describe('deriveSubFields trial dates (admin CRM read "trial ended" off currentPeriodEnd)', () => {
  const NOW = Date.parse('2026-08-03T00:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;
  // What a trialing user's doc actually holds: currentPeriodEnd is the free-quote
  // counter's calendar month end, which sits in the PAST for the first days of
  // every month and has nothing to do with the trial.
  const trialingUser = {
    isPro: false,
    trialStartedAt: new Date(NOW - 4 * DAY).toISOString(),
    currentPeriodStart: '2026-07-01T00:00:00.000Z',
    currentPeriodEnd: '2026-07-31T13:59:59.000Z',
  };

  it('reports a trial end 14 days after the start, not the quota month end', () => {
    const f = deriveSubFields(trialingUser, NOW);
    expect(f.status).toBe('trialing');
    expect(f.trialEndsAt).toBe(Date.parse(trialingUser.trialStartedAt) + TRIAL_MS);
    expect(f.trialEndsAt!).toBeGreaterThan(NOW);
    expect(f.currentPeriodEnd!).toBeLessThan(NOW);
  });

  it('never reports a trialing user as already ended', () => {
    const f = deriveSubFields(trialingUser, NOW);
    expect(f.trialDaysRemaining).toBe(10);
    expect(Math.ceil((f.trialEndsAt! - NOW) / DAY)).toBeGreaterThan(0);
  });

  it('dates an expired trial from its start, not from the month boundary', () => {
    const f = deriveSubFields(
      { ...trialingUser, trialStartedAt: new Date(NOW - 20 * DAY).toISOString() },
      NOW,
    );
    expect(f.status).toBe('trial_expired');
    expect(Math.floor((NOW - f.trialEndsAt!) / DAY)).toBe(6);
  });

  it('leaves trialEndsAt null when no trial ever started', () => {
    expect(deriveSubFields({ isPro: false, currentPeriodEnd: '2026-07-31T13:59:59.000Z' }, NOW).trialEndsAt).toBeNull();
    expect(deriveSubFields(undefined, NOW).trialEndsAt).toBeNull();
  });
});

describe('resolveServerPlan (PAY-02 MAJOR-1 — client plan string is not trusted)', () => {
  const NOW = Date.parse('2026-07-19T00:00:00Z');
  const inTrial = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
  const expiredTrial = new Date(NOW - TRIAL_MS - 1000).toISOString();

  it('returns trial when the subscription doc is missing', () => {
    expect(resolveServerPlan(undefined, NOW)).toBe('trial');
    expect(resolveServerPlan(null, NOW)).toBe('trial');
  });

  it('keys Pro off the server-owned isPro flag', () => {
    expect(resolveServerPlan({ isPro: true }, NOW)).toBe('pro');
    expect(resolveServerPlan({ isPro: true, trialStartedAt: expiredTrial }, NOW)).toBe('pro');
  });

  it('IGNORES a forged client plan:pro on a non-Pro doc — regression for the fee/gate bypass', () => {
    expect(resolveServerPlan({ isPro: false, plan: 'pro', trialStartedAt: expiredTrial }, NOW)).toBe('free');
  });

  it('IGNORES a forged client plan:trial on an expired-trial doc — regression for the free-tier gate bypass', () => {
    expect(resolveServerPlan({ plan: 'trial', trialStartedAt: expiredTrial }, NOW)).toBe('free');
  });

  it('derives trial vs free from trialStartedAt, not the stored plan', () => {
    expect(resolveServerPlan({ trialStartedAt: inTrial }, NOW)).toBe('trial');
    expect(resolveServerPlan({ trialStartedAt: expiredTrial }, NOW)).toBe('free');
    // stored plan:'free' must not override an in-window trial computation
    expect(resolveServerPlan({ plan: 'free', trialStartedAt: inTrial }, NOW)).toBe('trial');
  });

  it('treats the trial boundary as exclusive (>= TRIAL_MS is free)', () => {
    expect(resolveServerPlan({ trialStartedAt: new Date(NOW - TRIAL_MS).toISOString() }, NOW)).toBe('free');
    expect(resolveServerPlan({ trialStartedAt: new Date(NOW - TRIAL_MS + 1000).toISOString() }, NOW)).toBe('trial');
  });

  it('accepts a Firestore Timestamp-like trialStartedAt (toDate)', () => {
    const ts = { toDate: () => new Date(inTrial) };
    expect(resolveServerPlan({ trialStartedAt: ts }, NOW)).toBe('trial');
  });

  it('falls back to trial when trialStartedAt is unparseable', () => {
    expect(resolveServerPlan({ trialStartedAt: 'not-a-date' }, NOW)).toBe('trial');
  });
});
