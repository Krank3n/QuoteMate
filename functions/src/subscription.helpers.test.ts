import { describe, it, expect } from 'vitest';
import {
  isBilledSub,
  subEnvironment,
  deriveSubFields,
  resolveServerPlan,
  subPriceInfo,
  storePricePatch,
  storePurchaseKey,
  netMonthlyRevenueAud,
  monthlyRevenueAud,
  rollupRevenue,
  RevenueEntry,
  TRIAL_MS,
} from './subscription.helpers';

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

describe('subPriceInfo — what a subscriber is REALLY charged', () => {
  it('prefers the price stamped on the doc over the list price', () => {
    // The Android plans were A$29/mo until 2026-08-04; Play keeps billing the
    // signup price forever, so pricing this sub at today's $49 overstates MRR.
    const grandfathered = {
      isPro: true,
      platform: 'android',
      productId: 'quotemate_premium_monthly',
      priceMicros: 29000000,
      priceCurrency: 'AUD',
      priceInterval: 'monthly',
    };
    expect(subPriceInfo(grandfathered)).toEqual({
      amount: 29,
      currency: 'AUD',
      interval: 'monthly',
      source: 'store',
    });
    expect(monthlyRevenueAud(grandfathered)).toBe(29);
  });

  it('reads the signed price out of an Apple JWS (milliunits)', () => {
    const appleYearly = {
      isPro: true,
      platform: 'ios',
      productId: 'quotemate_pro_yearly',
      purchaseToken: jwsWith({ environment: 'Production', price: 329000, currency: 'AUD' }),
    };
    // Apple charges A$329 for the yearly tier, not the $328 list price.
    expect(subPriceInfo(appleYearly).amount).toBe(329);
    expect(subPriceInfo(appleYearly).source).toBe('store');
    expect(monthlyRevenueAud(appleYearly)).toBeCloseTo(27.42, 2);
  });

  it('falls back to the list price and says so', () => {
    const noPrice = { isPro: true, platform: 'android', productId: 'quotemate_pro_yearly' };
    expect(subPriceInfo(noPrice)).toEqual({ amount: 328, currency: 'AUD', interval: 'yearly', source: 'listed' });
  });

  it('does not bank a foreign-currency sub at face value', () => {
    const usd = {
      isPro: true,
      platform: 'ios',
      productId: 'quotemate_pro_yearly',
      priceMicros: 190000000,
      priceCurrency: 'USD',
      environment: 'Production',
    };
    expect(monthlyRevenueAud(usd)).toBe(0);
  });

  it('stops counting a sub whose paid period has run out', () => {
    const NOW = Date.parse('2026-08-31T00:00:00Z');
    const lapsed = {
      isPro: true,
      platform: 'android',
      productId: 'quotemate_premium_monthly',
      priceMicros: 49000000,
      priceCurrency: 'AUD',
      currentPeriodEnd: '2026-07-15T00:00:00.000Z',
    };
    expect(monthlyRevenueAud(lapsed, NOW)).toBe(0);
    expect(deriveSubFields(lapsed, NOW).periodEnded).toBe(true);
    // …but it is still a real billing record, not a comp.
    expect(deriveSubFields(lapsed, NOW).billed).toBe(true);
  });
});

describe('storePricePatch', () => {
  const now = new Date('2026-08-31T00:00:00Z');

  it('records the amount, currency and where it came from', () => {
    expect(storePricePatch({ micros: 29000000, currency: 'aud', interval: 'monthly', source: 'google', now })).toEqual({
      priceMicros: 29000000,
      priceCurrency: 'AUD',
      priceInterval: 'monthly',
      priceCapturedFrom: 'google',
      priceCapturedAt: now.toISOString(),
    });
  });

  it('writes nothing when the store gave no usable price — never blank out a good one', () => {
    expect(storePricePatch({ micros: null, currency: 'AUD', interval: 'monthly', source: 'apple' })).toEqual({});
    expect(storePricePatch({ micros: 0, currency: 'AUD', interval: 'monthly', source: 'apple' })).toEqual({});
    expect(storePricePatch({ micros: NaN, currency: 'AUD', interval: 'monthly', source: 'apple' })).toEqual({});
    expect(storePricePatch({ micros: 49000000, currency: null, interval: 'monthly', source: 'apple' })).toEqual({});
  });
});

describe('netMonthlyRevenueAud — money that actually lands', () => {
  it('takes GST and the 15% store cut off an app-store sub', () => {
    const sub = {
      isPro: true,
      platform: 'android',
      productId: 'quotemate_premium_monthly',
      priceMicros: 49000000,
      priceCurrency: 'AUD',
    };
    // 49 / 1.1 = 44.5454 ex-GST, less 15% = 37.86
    expect(netMonthlyRevenueAud(sub)).toBeCloseTo(37.86, 2);
  });

  it('takes only the processing fee off a Stripe sub, spread across an annual term', () => {
    const monthly = { isPro: true, platform: 'web', subscriptionId: 'sub_1', priceMicros: 49000000, priceCurrency: 'AUD', priceInterval: 'monthly' };
    expect(netMonthlyRevenueAud(monthly)).toBeCloseTo(49 * 0.9825 - 0.3, 2);

    const yearly = { isPro: true, platform: 'web', subscriptionId: 'sub_2', priceMicros: 328000000, priceCurrency: 'AUD', priceInterval: 'yearly' };
    expect(netMonthlyRevenueAud(yearly)).toBeCloseTo((328 / 12) * 0.9825 - 0.3 / 12, 2);
  });
});

describe('storePurchaseKey — one purchase, however many accounts carry it', () => {
  it('keys an Android sub on its purchase token, ignoring renewal order suffixes', () => {
    expect(storePurchaseKey({ platform: 'android', purchaseToken: 'abc123' })).toBe('android:abc123');
    expect(storePurchaseKey({ platform: 'android', transactionId: 'GPA.3338-8160-7569-98540..2' }))
      .toBe('android:GPA.3338-8160-7569-98540');
  });

  it('keys an iOS sub on the original transaction id, which survives renewals', () => {
    const sub = {
      platform: 'ios',
      transactionId: '999',
      purchaseToken: jwsWith({ originalTransactionId: '510002785520736', transactionId: '999' }),
    };
    expect(storePurchaseKey(sub)).toBe('ios:510002785520736');
  });

  it('keys a web sub on its Stripe subscription', () => {
    expect(storePurchaseKey({ platform: 'web', subscriptionId: 'sub_123' })).toBe('web:sub_123');
  });
});

describe('rollupRevenue', () => {
  const entry = (over: Partial<RevenueEntry>): RevenueEntry => ({
    uid: 'u1',
    billed: true,
    platform: 'android',
    interval: 'monthly',
    monthlyAud: 49,
    netMonthlyAud: 37.86,
    priceAmount: 49,
    priceCurrency: 'AUD',
    priceSource: 'store',
    periodEnded: false,
    purchaseKey: 'android:token-1',
    ...over,
  });

  it('counts one store purchase once, however many accounts hold it', () => {
    // The real case: one Play subscription landed on two Firebase accounts
    // after a failed validation, and MRR counted it twice.
    const r = rollupRevenue([
      entry({ uid: 'a' }),
      entry({ uid: 'b' }),
    ]);
    expect(r.payers).toBe(1);
    expect(r.mrrGross).toBe(49);
    expect(r.duplicateUids).toEqual(['b']);
  });

  it('keeps lapsed periods out of MRR but reports what is at risk', () => {
    const r = rollupRevenue([
      entry({ uid: 'a' }),
      entry({ uid: 'b', purchaseKey: 'android:token-2', periodEnded: true, monthlyAud: 0, netMonthlyAud: 0, priceAmount: 328, interval: 'yearly' }),
    ]);
    expect(r.payers).toBe(1);
    expect(r.mrrGross).toBe(49);
    expect(r.lapsed).toEqual({ count: 1, mrrGross: 27.33 });
  });

  it('splits gross and net by platform and flags estimated pricing', () => {
    const r = rollupRevenue([
      entry({ uid: 'a', purchaseKey: 'android:t1' }),
      entry({ uid: 'b', platform: 'ios', purchaseKey: 'ios:1', interval: 'yearly', monthlyAud: 27.42, netMonthlyAud: 21.18, priceAmount: 329 }),
      entry({ uid: 'c', platform: 'ios', purchaseKey: 'ios:2', priceSource: 'listed', monthlyAud: 49, netMonthlyAud: 37.86 }),
    ]);
    expect(r.payers).toBe(3);
    expect(r.byPlatform.android.payers).toBe(1);
    expect(r.byPlatform.ios).toEqual({ payers: 2, mrrGross: 76.42, mrrNet: 59.04 });
    expect(r.byInterval).toEqual({ monthly: 2, yearly: 1 });
    expect(r.estimatedPricing).toBe(1);
    expect(r.arrGross).toBe(round(125.42 * 12));
  });

  it('excludes comps and counts restored-but-unverified payers separately', () => {
    const r = rollupRevenue([
      entry({ uid: 'a' }),
      entry({ uid: 'comp', billed: false, monthlyAud: 0, netMonthlyAud: 0, purchaseKey: null }),
      entry({ uid: 'restored', billed: false, restored: true, monthlyAud: 0, netMonthlyAud: 0, purchaseKey: null }),
    ]);
    expect(r.payers).toBe(1);
    expect(r.restoredUnverified).toBe(1);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
