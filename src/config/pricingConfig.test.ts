import { describe, it, expect } from 'vitest';
import {
  ACTUAL_PRICE_AUD,
  REGULAR_PRICE_AUD,
  regularPriceLabel,
  discountPercent,
  yearlyVsMonthlySavingsPercent,
  monthlyFeeSaving,
  feeSavingLabel,
  squareCollectedLast30d,
  FEE_SAVING_CLAIM_THRESHOLD_AUD,
} from './pricingConfig';

describe('pricingConfig', () => {
  it('keeps the charged prices at the current $49 / $328 AUD', () => {
    // These must match the live store / Stripe products, not the anchor.
    expect(ACTUAL_PRICE_AUD).toEqual({ monthly: 49, yearly: 328 });
  });

  it('anchor (regular) price is strictly higher than the charged price for every period', () => {
    (['monthly', 'yearly'] as const).forEach((period) => {
      expect(REGULAR_PRICE_AUD[period]).toBeGreaterThan(ACTUAL_PRICE_AUD[period]);
    });
  });

  it('formats the regular price label with a leading dollar sign', () => {
    expect(regularPriceLabel('monthly')).toBe('$99');
    expect(regularPriceLabel('yearly')).toBe('$658');
  });

  it('computes a whole-number discount percent off the regular price', () => {
    expect(discountPercent('monthly')).toBe(51); // 1 - 49/99  = 50.5% -> 51
    expect(discountPercent('yearly')).toBe(50); //  1 - 328/658 = 50.2% -> 50
  });

  it('always reports a positive, sub-100 discount', () => {
    (['monthly', 'yearly'] as const).forEach((period) => {
      const pct = discountPercent(period);
      expect(pct).toBeGreaterThan(0);
      expect(pct).toBeLessThan(100);
    });
  });
});

describe('yearlyVsMonthlySavingsPercent', () => {
  it('derives 44 from the charged prices (replaces the hardcoded badge)', () => {
    // $328/yr vs $588 (12 × $49) → 44.2% → 44.
    expect(yearlyVsMonthlySavingsPercent()).toBe(44);
  });
});

describe('fee-bleed (Pro upsell from real Square volume only)', () => {
  it('computes the monthly saving from the fee delta (170 → 100 bps)', () => {
    expect(monthlyFeeSaving(7400)).toBeCloseTo(51.8);
    expect(monthlyFeeSaving(1000)).toBeCloseTo(7);
  });

  it('zero, negative or garbage volume saves nothing', () => {
    expect(monthlyFeeSaving(0)).toBe(0);
    expect(monthlyFeeSaving(-500)).toBe(0);
    expect(monthlyFeeSaving(NaN)).toBe(0);
  });

  it('labels a real saving with a rounded dollar figure', () => {
    expect(feeSavingLabel(7400)).toBe(
      "On your recent volume, Pro's lower fee would keep you about $52/mo"
    );
  });

  it('makes NO claim when the saving is thin — never invents value', () => {
    // $500 collected → $3.50/mo, under the $5 threshold.
    expect(monthlyFeeSaving(500)).toBeLessThan(FEE_SAVING_CLAIM_THRESHOLD_AUD);
    expect(feeSavingLabel(500)).toBeNull();
    expect(feeSavingLabel(0)).toBeNull();
  });
});

describe('squareCollectedLast30d', () => {
  const NOW = Date.parse('2026-07-16T00:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;
  const pay = (amount: number, daysAgo: number, method?: string) => ({
    amount,
    paidAt: NOW - daysAgo * DAY,
    method,
  });

  it('sums only square payments inside the 30-day window', () => {
    const docs = [
      { payments: [pay(1000, 5, 'square'), pay(500, 10, 'square')] },
      { payments: [pay(2000, 45, 'square')] }, // too old
      { payments: [pay(300, 2, 'cash')] }, // manual — no platform fee saved
      { payments: [{ amount: 400, method: 'square' }] }, // no paidAt — untrusted
      {}, // no payments at all
    ];
    expect(squareCollectedLast30d(docs, NOW)).toBe(1500);
  });

  it('ignores future-dated payments and empty inputs', () => {
    expect(squareCollectedLast30d([{ payments: [pay(1000, -2, 'square')] }], NOW)).toBe(0);
    expect(squareCollectedLast30d([], NOW)).toBe(0);
  });
});
