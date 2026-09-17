import { describe, it, expect } from 'vitest';
import { introOfferFromProduct, isoDurationDays, periodDays, pickAndroidOfferToken } from './storeOffers';

const freePhase = { billingPeriod: 'P2W', billingCycleCount: 1, priceAmountMicros: '0', formattedPrice: 'Free', priceCurrencyCode: 'AUD', recurrenceMode: 2 };
const paidPhase = { billingPeriod: 'P1M', billingCycleCount: 0, priceAmountMicros: '49000000', formattedPrice: '$49.00', priceCurrencyCode: 'AUD', recurrenceMode: 1 };
const basePlan = { id: '', basePlanIdAndroid: 'quotemate-monthly', offerTokenAndroid: 'tok-base', pricingPhasesAndroid: { pricingPhaseList: [paidPhase] } };
const introOffer = { id: 'free-trial-14d', basePlanIdAndroid: 'quotemate-monthly', offerTokenAndroid: 'tok-intro', pricingPhasesAndroid: { pricingPhaseList: [freePhase, paidPhase] } };

describe('storeOffers', () => {
  it('parses ISO durations and StoreKit periods into days', () => {
    expect(isoDurationDays('P2W')).toBe(14);
    expect(isoDurationDays('P14D')).toBe(14);
    expect(isoDurationDays('P1M')).toBe(30);
    expect(isoDurationDays('P0D')).toBeNull();
    expect(isoDurationDays('nonsense')).toBeNull();
    expect(periodDays({ unit: 'week', value: 2 })).toBe(14);
    expect(periodDays({ unit: 'day', value: 3 })).toBe(3);
    expect(periodDays({ unit: 'fortnight', value: 1 })).toBeNull();
  });

  describe('introOfferFromProduct', () => {
    it('reads a free Android offer and its token', () => {
      expect(introOfferFromProduct({ subscriptionOffers: [basePlan, introOffer] })).toEqual({
        freeDays: 14,
        offerTokenAndroid: 'tok-intro',
      });
    });

    it('ignores a free offer that hangs off a base plan Play did not list as buyable', () => {
      const prepaidIntro = { ...introOffer, id: 'prepaid-free', basePlanIdAndroid: 'quotemate-prepaid', offerTokenAndroid: 'tok-prepaid' };
      expect(introOfferFromProduct({ subscriptionOffers: [basePlan, prepaidIntro] })).toBeNull();
      expect(pickAndroidOfferToken([basePlan, prepaidIntro])).toBe('tok-base');
      // …but still finds the one on the sold base plan alongside it.
      expect(introOfferFromProduct({ subscriptionOffers: [basePlan, prepaidIntro, introOffer] })?.offerTokenAndroid).toBe('tok-intro');
    });

    it('reports nothing when Play lists only the base plan (buyer already used the offer)', () => {
      expect(introOfferFromProduct({ subscriptionOffers: [basePlan] })).toBeNull();
    });

    it('reads a free iOS introductory offer', () => {
      const product = { subscriptionInfoIOS: { subscriptionGroupId: '21961692', introductoryOffer: { paymentMode: 'free-trial', period: { unit: 'week', value: 2 }, periodCount: 1, price: 0 } } };
      expect(introOfferFromProduct(product)).toEqual({ freeDays: 14, offerTokenAndroid: null });
      expect(introOfferFromProduct(product, { eligibleIOS: true })).toEqual({ freeDays: 14, offerTokenAndroid: null });
    });

    it('suppresses the iOS offer for a buyer StoreKit says is not eligible', () => {
      const product = { subscriptionInfoIOS: { introductoryOffer: { paymentMode: 'free-trial', period: { unit: 'week', value: 2 }, periodCount: 1 } } };
      expect(introOfferFromProduct(product, { eligibleIOS: false })).toBeNull();
    });

    it('ignores paid introductory pricing — only a free period is a "free days" claim', () => {
      const product = { subscriptionInfoIOS: { introductoryOffer: { paymentMode: 'pay-as-you-go', period: { unit: 'month', value: 1 }, periodCount: 3 } } };
      expect(introOfferFromProduct(product)).toBeNull();
    });

    it('is null for a product with no offer data at all (web, or a store that sent none)', () => {
      expect(introOfferFromProduct({ id: 'quotemate_pro_monthly', displayPrice: '$49' })).toBeNull();
      expect(introOfferFromProduct(null)).toBeNull();
    });
  });

  describe('pickAndroidOfferToken', () => {
    it('buys with the free intro offer when Play lists one', () => {
      expect(pickAndroidOfferToken([basePlan, introOffer])).toBe('tok-intro');
      expect(pickAndroidOfferToken([introOffer, basePlan])).toBe('tok-intro');
    });
    it('falls back to the base plan, then to the first listed offer', () => {
      expect(pickAndroidOfferToken([basePlan])).toBe('tok-base');
      expect(pickAndroidOfferToken([{ id: 'promo', offerTokenAndroid: 'tok-promo', pricingPhasesAndroid: { pricingPhaseList: [paidPhase] } }])).toBe('tok-promo');
      expect(pickAndroidOfferToken([])).toBeNull();
      expect(pickAndroidOfferToken(undefined)).toBeNull();
    });
  });
});
