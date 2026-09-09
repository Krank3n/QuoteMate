/**
 * Card surcharging was retired in September 2026 ahead of the RBA's ban on
 * surcharging eftpos, Mastercard and Visa from 1 October 2026. Before that a
 * tradie could opt into a 2.9% uplift on every card payment through
 * `surchargePaymentFees` on their business settings. That document is still
 * in Firestore for anyone who switched it on, so the pricing helper must not
 * even be able to see it: the customer is charged exactly what is owed.
 */

import { describe, it, expect } from 'vitest';
import { computeSquarePricing } from './squarePricing.helpers';

describe('computeSquarePricing', () => {
  it('charges the customer exactly the amount owed — no surcharge, ever', () => {
    const { chargedDollars } = computeSquarePricing(1000, 'online', 'free');
    expect(chargedDollars).toBe(1000);
  });

  it('takes no settings, so a stale surchargePaymentFees flag cannot change the charge', () => {
    // The old signature was (base, businessSettings, channel, plan). If anyone
    // reintroduces a settings argument this stops compiling.
    const fn: (base: number, channel: 'online' | 'in_person', plan?: 'trial' | 'free' | 'pro') => unknown =
      computeSquarePricing;
    expect(fn.length).toBeLessThanOrEqual(3);
  });

  it('takes the platform fee out of the tradie side, at the plan and channel rate', () => {
    expect(computeSquarePricing(1000, 'online', 'free').appFeeCents).toBe(1700);   // 1.7%
    expect(computeSquarePricing(1000, 'online', 'pro').appFeeCents).toBe(1000);    // 1.0%
    expect(computeSquarePricing(1000, 'online', 'trial').appFeeCents).toBe(1000);  // trial = pro rate
    expect(computeSquarePricing(1000, 'in_person', 'free').appFeeCents).toBe(1700);
    expect(computeSquarePricing(1000, 'in_person', 'pro').appFeeCents).toBe(1500); // 1.5%
  });

  it('rounds to whole cents and never goes negative', () => {
    const { chargedDollars, appFeeCents } = computeSquarePricing(33.33, 'online', 'pro');
    expect(chargedDollars).toBe(33.33);
    expect(Number.isInteger(appFeeCents)).toBe(true);
    expect(computeSquarePricing(0, 'online', 'free').appFeeCents).toBe(0);
  });
});
