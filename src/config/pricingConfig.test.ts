import { describe, it, expect } from 'vitest';
import {
  ACTUAL_PRICE_AUD,
  REGULAR_PRICE_AUD,
  regularPriceLabel,
  discountPercent,
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
