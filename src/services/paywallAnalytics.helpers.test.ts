import { describe, expect, it } from 'vitest';
import { planFromSku, resolvePurchaseAnalytics } from './paywallAnalytics.helpers';

describe('planFromSku', () => {
  it('maps both SKU families (billingService SUBSCRIPTION_SKUS) to plans', () => {
    // iOS family
    expect(planFromSku('quotemate_pro_monthly')).toBe('monthly');
    expect(planFromSku('quotemate_pro_yearly')).toBe('yearly');
    // Android family
    expect(planFromSku('quotemate_premium_monthly')).toBe('monthly');
    expect(planFromSku('quotemate_premium_yearly')).toBe('yearly');
  });

  it('handles case and "annual" variants', () => {
    expect(planFromSku('QUOTEMATE_PRO_YEARLY')).toBe('yearly');
    expect(planFromSku('pro_annual')).toBe('yearly');
  });

  it('resolves to unknown for Stripe price ids and missing values', () => {
    expect(planFromSku('price_1SKCkZAbCdEf')).toBe('unknown');
    expect(planFromSku(null)).toBe('unknown');
    expect(planFromSku(undefined)).toBe('unknown');
    expect(planFromSku('')).toBe('unknown');
  });
});

describe('resolvePurchaseAnalytics', () => {
  it('builds the purchase_completed payload from a store purchase', () => {
    expect(
      resolvePurchaseAnalytics({ productId: 'quotemate_pro_yearly' }, 'ios')
    ).toEqual({ plan: 'yearly', platform: 'ios' });
    expect(
      resolvePurchaseAnalytics({ productId: 'quotemate_premium_monthly' }, 'android')
    ).toEqual({ plan: 'monthly', platform: 'android' });
  });

  it('degrades to unknown when the purchase object is malformed', () => {
    expect(resolvePurchaseAnalytics(null, 'ios')).toEqual({ plan: 'unknown', platform: 'ios' });
    expect(resolvePurchaseAnalytics({}, 'android')).toEqual({ plan: 'unknown', platform: 'android' });
  });
});
