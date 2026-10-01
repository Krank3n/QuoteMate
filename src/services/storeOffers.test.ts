import { describe, it, expect } from 'vitest';
import { introOfferFromProduct, isoDurationDays, mayTakeStoreFreeTrial, periodDays, pickAndroidOfferToken, storeFreeDaysToShow } from './storeOffers';

const freePhase = { billingPeriod: 'P2W', billingCycleCount: 1, priceAmountMicros: '0', formattedPrice: 'Free', priceCurrencyCode: 'AUD', recurrenceMode: 2 };
const paidPhase = { billingPeriod: 'P1M', billingCycleCount: 0, priceAmountMicros: '49000000', formattedPrice: '$49.00', priceCurrencyCode: 'AUD', recurrenceMode: 1 };
// Real expo-iap 3.4 shape: openiap-google sets id = offerId ?: basePlanId.
const basePlan = { id: 'quotemate-monthly', basePlanIdAndroid: 'quotemate-monthly', offerTokenAndroid: 'tok-base', pricingPhasesAndroid: { pricingPhaseList: [paidPhase] } };
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
      expect(pickAndroidOfferToken([basePlan, prepaidIntro], { allowFreeTrial: true })).toBe('tok-base');
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
    const allow = { allowFreeTrial: true };
    it('buys with the free intro offer when the trial allows it and Play lists one', () => {
      expect(pickAndroidOfferToken([basePlan, introOffer], allow)).toBe('tok-intro');
      expect(pickAndroidOfferToken([introOffer, basePlan], allow)).toBe('tok-intro');
    });
    it('buys the base plan, never the free offer, once the trial is over (the 1 Oct second-trial bug)', () => {
      expect(pickAndroidOfferToken([basePlan, introOffer], { allowFreeTrial: false })).toBe('tok-base');
      expect(pickAndroidOfferToken([introOffer, basePlan], { allowFreeTrial: false })).toBe('tok-base');
    });
    it('buys the base plan, not a paid promo or the free offer, once the trial is over', () => {
      const paidPromo = { id: 'winback', basePlanIdAndroid: 'quotemate-monthly', offerTokenAndroid: 'tok-promo', pricingPhasesAndroid: { pricingPhaseList: [{ ...paidPhase, priceAmountMicros: '25000000' }, paidPhase] } };
      expect(pickAndroidOfferToken([paidPromo, introOffer, basePlan], { allowFreeTrial: false })).toBe('tok-base');
      expect(pickAndroidOfferToken([paidPromo, introOffer, basePlan], allow)).toBe('tok-intro');
    });
    it('still recognises the older empty-id base plan entry', () => {
      const legacyBase = { ...basePlan, id: '' };
      expect(pickAndroidOfferToken([introOffer, legacyBase])).toBe('tok-base');
    });
    it('withholds the free offer by default — a caller that does not know the trial state bills on tap', () => {
      expect(pickAndroidOfferToken([introOffer, basePlan])).toBe('tok-base');
    });
    it('without the free offer, takes a paid offer before ever falling back to a free one', () => {
      const paidPromo = { id: 'promo', offerTokenAndroid: 'tok-promo', pricingPhasesAndroid: { pricingPhaseList: [paidPhase] } };
      expect(pickAndroidOfferToken([introOffer, paidPromo])).toBe('tok-promo');
      expect(pickAndroidOfferToken([introOffer])).toBeNull();
    });
    it('falls back to the base plan, then to the first listed offer', () => {
      expect(pickAndroidOfferToken([basePlan], allow)).toBe('tok-base');
      expect(pickAndroidOfferToken([{ id: 'promo', offerTokenAndroid: 'tok-promo', pricingPhasesAndroid: { pricingPhaseList: [paidPhase] } }], allow)).toBe('tok-promo');
      expect(pickAndroidOfferToken([], allow)).toBeNull();
      expect(pickAndroidOfferToken(undefined)).toBeNull();
    });
  });

  describe('mayTakeStoreFreeTrial', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const NOW = Date.parse('2026-10-01T10:11:00Z');
    it('allows it before the trial has started (it starts on the first quote)', () => {
      expect(mayTakeStoreFreeTrial({ trialExpired: false }, NOW)).toBe(true);
      expect(mayTakeStoreFreeTrial({}, NOW)).toBe(true);
    });
    it('allows it mid-trial, so subscribing early is not billed on tap', () => {
      expect(mayTakeStoreFreeTrial({ trialStartedAt: new Date(NOW - 3 * DAY), trialExpired: false }, NOW)).toBe(true);
    });
    it('refuses it once the trial window has passed, even before the server flags it', () => {
      // e0p0…: trial from 13 Sep, subscribed 1 Oct and Apple gave 14 more free days.
      expect(mayTakeStoreFreeTrial({ trialStartedAt: new Date('2026-09-13T05:35:11Z'), trialExpired: false }, NOW)).toBe(false);
      expect(mayTakeStoreFreeTrial({ trialStartedAt: new Date(NOW - 14 * DAY), trialExpired: false }, NOW)).toBe(false);
    });
    it('refuses it when the server has flagged the trial expired', () => {
      expect(mayTakeStoreFreeTrial({ trialStartedAt: new Date(NOW - 3 * DAY), trialExpired: true }, NOW)).toBe(false);
      expect(mayTakeStoreFreeTrial({ trialExpired: true }, NOW)).toBe(false);
    });
    it('follows an explicit trialEndsAt (the return trial) both ways', () => {
      const lapsedStart = new Date(NOW - 90 * DAY);
      expect(mayTakeStoreFreeTrial({ trialStartedAt: lapsedStart, trialEndsAt: new Date(NOW + 2 * DAY), trialExpired: false }, NOW)).toBe(true);
      expect(mayTakeStoreFreeTrial({ trialStartedAt: lapsedStart, trialEndsAt: new Date(NOW - DAY), trialExpired: false }, NOW)).toBe(false);
    });
    it('fails closed while the subscription status has not loaded', () => {
      expect(mayTakeStoreFreeTrial(null, NOW)).toBe(false);
      expect(mayTakeStoreFreeTrial(undefined, NOW)).toBe(false);
    });
  });

  describe('storeFreeDaysToShow', () => {
    it('shows the store days only when Android will actually ask for the offer', () => {
      expect(storeFreeDaysToShow('android', 14, true)).toBe(14);
      expect(storeFreeDaysToShow('android', 14, false)).toBeNull();
    });
    it('follows StoreKit on iOS, which applies the offer whatever the app wants', () => {
      expect(storeFreeDaysToShow('ios', 14, false)).toBe(14);
      expect(storeFreeDaysToShow('ios', null, true)).toBeNull();
    });
    it('is null with no usable store offer', () => {
      expect(storeFreeDaysToShow('android', null, true)).toBeNull();
      expect(storeFreeDaysToShow('android', 0, true)).toBeNull();
      expect(storeFreeDaysToShow('web', undefined, true)).toBeNull();
    });
  });
});
