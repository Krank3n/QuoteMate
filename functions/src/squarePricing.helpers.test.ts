/**
 * Card surcharging was retired in September 2026 ahead of the RBA's ban on
 * surcharging eftpos, Mastercard and Visa from 1 October 2026. Before that a
 * tradie could opt into a 2.9% uplift on every card payment through
 * `surchargePaymentFees` on their business settings. That document is still
 * in Firestore for anyone who switched it on, so the pricing helper must not
 * even be able to see it: the customer is charged exactly what is owed.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSquarePricing,
  mintedBeforeSurchargeRetirement,
  SURCHARGE_RETIRED_AT_MS,
} from './squarePricing.helpers';

describe('computeSquarePricing', () => {
  it('charges the customer exactly the amount owed — no surcharge, ever', () => {
    const { chargedDollars } = computeSquarePricing(1000, 'online', 'free');
    expect(chargedDollars).toBe(1000);
  });

  it('takes no settings, so a stale surchargePaymentFees flag cannot change the charge', () => {
    // The old signature was (base, businessSettings, channel, plan) — four
    // parameters, three without a default. Test files are excluded from tsc,
    // so this is checked at runtime: two required parameters, no settings.
    expect(computeSquarePricing.length).toBe(2);
    // And the amount is the amount, whatever the plan or channel.
    for (const plan of ['trial', 'free', 'pro'] as const) {
      for (const channel of ['online', 'in_person'] as const) {
        expect(computeSquarePricing(487.5, channel, plan).chargedDollars).toBe(487.5);
      }
    }
  });

  it('takes the platform fee out of the tradie side, at the plan and channel rate', () => {
    expect(computeSquarePricing(1000, 'online', 'free').appFeeCents).toBe(1700);   // 1.7%
    expect(computeSquarePricing(1000, 'online', 'pro').appFeeCents).toBe(1000);    // 1.0%
    expect(computeSquarePricing(1000, 'online', 'trial').appFeeCents).toBe(1000);  // trial = pro rate
    expect(computeSquarePricing(1000, 'in_person', 'free').appFeeCents).toBe(1700);
    expect(computeSquarePricing(1000, 'in_person', 'pro').appFeeCents).toBe(1500); // 1.5%
  });

  describe('pay links minted before the ban', () => {
    const before = Date.parse('2026-09-30T23:59:59+10:00');
    const after = Date.parse('2026-10-01T00:00:01+10:00');

    it('are never reused after the surcharge retirement', () => {
      expect(mintedBeforeSurchargeRetirement(before)).toBe(true);
      expect(mintedBeforeSurchargeRetirement(SURCHARGE_RETIRED_AT_MS - 1)).toBe(true);
    });

    it('but a link minted after it is fine', () => {
      expect(mintedBeforeSurchargeRetirement(after)).toBe(false);
      expect(mintedBeforeSurchargeRetirement(SURCHARGE_RETIRED_AT_MS)).toBe(false);
    });

    it('treats a link with no createdAt stamp as pre-retirement', () => {
      expect(mintedBeforeSurchargeRetirement(undefined)).toBe(true);
      expect(mintedBeforeSurchargeRetirement(null)).toBe(true);
      expect(mintedBeforeSurchargeRetirement(0)).toBe(true);
      expect(mintedBeforeSurchargeRetirement(Number.NaN)).toBe(true);
    });
  });

  it('rounds to whole cents and never goes negative', () => {
    const { chargedDollars, appFeeCents } = computeSquarePricing(33.33, 'online', 'pro');
    expect(chargedDollars).toBe(33.33);
    expect(Number.isInteger(appFeeCents)).toBe(true);
    expect(computeSquarePricing(0, 'online', 'free').appFeeCents).toBe(0);
  });
});
