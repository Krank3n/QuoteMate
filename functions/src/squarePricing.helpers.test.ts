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
  squareFeeFieldsFromPayment,
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

  it('a free tradie pays 1.7% in person and a Pro or trial tradie 1.5% — the schedule the phone must match', () => {
    expect(computeSquarePricing(1200, 'in_person', 'free').appFeeCents).toBe(2040);
    expect(computeSquarePricing(1200, 'in_person', 'pro').appFeeCents).toBe(1800);
    expect(computeSquarePricing(1200, 'in_person', 'trial').appFeeCents).toBe(1800);
  });
});

/**
 * Sep 2026 money reconciliation: every squarePayments row carried only a
 * RECOMPUTED appFeeCents, so nobody could tell from the ledger whether Square
 * had actually deducted the platform fee. The webhook now stores Square's own
 * figures beside ours.
 */
describe('squareFeeFieldsFromPayment', () => {
  it('reads app_fee_money and a single processing fee, and flags no mismatch when they agree', () => {
    const payment = {
      amount_money: { amount: 120000, currency: 'AUD' },
      app_fee_money: { amount: 1800, currency: 'AUD' },
      processing_fee: [
        { amount_money: { amount: 2028, currency: 'AUD' }, type: 'INITIAL', effective_at: '2026-09-12T01:00:00Z' },
      ],
    };
    expect(squareFeeFieldsFromPayment(payment, 1800)).toEqual({
      squareAppFeeCents: 1800,
      squareProcessingFeeCents: 2028,
      feeMismatch: false,
    });
  });

  it('sums several processing-fee entries (Square adds an ADJUSTMENT row on a partial refund)', () => {
    const payment = {
      app_fee_money: { amount: 1800, currency: 'AUD' },
      processing_fee: [
        { amount_money: { amount: 2028, currency: 'AUD' }, type: 'INITIAL' },
        { amount_money: { amount: -500, currency: 'AUD' }, type: 'ADJUSTMENT' },
      ],
    };
    expect(squareFeeFieldsFromPayment(payment, 1800).squareProcessingFeeCents).toBe(1528);
  });

  it('absent fee fields store null on both sides and no verdict on the mismatch', () => {
    expect(squareFeeFieldsFromPayment({ amount_money: { amount: 120000 } }, 1800)).toEqual({
      squareAppFeeCents: null,
      squareProcessingFeeCents: null,
      feeMismatch: null,
    });
    expect(squareFeeFieldsFromPayment(undefined, 1800).squareAppFeeCents).toBeNull();
  });

  it('malformed fee fields never throw — a webhook must not fail over an unreadable fee', () => {
    const payment = {
      app_fee_money: { amount: 'eighteen dollars' },
      processing_fee: 'not-an-array',
    };
    expect(squareFeeFieldsFromPayment(payment, 1800)).toEqual({
      squareAppFeeCents: null,
      squareProcessingFeeCents: null,
      feeMismatch: null,
    });
    // A broken entry inside an otherwise good list is skipped, not fatal.
    const mixed = { processing_fee: [{ amount_money: { amount: 2028 } }, null, { amount_money: {} }, { amount_money: { amount: 1.5 } }] };
    expect(squareFeeFieldsFromPayment(mixed, 1800).squareProcessingFeeCents).toBe(2028);
    // Square's JSON can carry an integer as a string; that still counts.
    expect(squareFeeFieldsFromPayment({ app_fee_money: { amount: '1800' } }, 1800).squareAppFeeCents).toBe(1800);
  });

  it('flags feeMismatch when Square took a different platform fee than the ledger recomputed', () => {
    // The Sep 2026 case: the phone sent the Pro rate (1.5%) for a free tradie
    // whose ledger row recomputes at 1.7%.
    const payment = { app_fee_money: { amount: 1800, currency: 'AUD' } };
    expect(squareFeeFieldsFromPayment(payment, 2040)).toMatchObject({ squareAppFeeCents: 1800, feeMismatch: true });
    // No recomputed figure to compare against → no verdict.
    expect(squareFeeFieldsFromPayment(payment, null).feeMismatch).toBeNull();
  });
});
