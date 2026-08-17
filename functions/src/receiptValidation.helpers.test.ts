import { describe, it, expect } from 'vitest';
import { receiptVerdict, isFirstGrantOfTransaction } from './receiptValidation.helpers';

const NOW = new Date('2026-07-17T00:00:00Z');

describe('receiptVerdict (PAY-01)', () => {
  it('rejects an affirmatively-invalid receipt terminally — regression for unconditional isPro grant', () => {
    const v = receiptVerdict({
      outcome: 'invalid',
      storeExpiry: new Date(NOW.getTime() + 86400000),
      productId: 'quotemate_pro_monthly',
      now: NOW,
    });
    expect(v).toEqual({ grant: false, reason: 'not_validated', retryable: false });
  });

  it('treats an unreachable store / missing credentials as RETRYABLE, not a rejection (PAY-01 MAJOR-2)', () => {
    const v = receiptVerdict({ outcome: 'unavailable', storeExpiry: null, productId: 'quotemate_pro_yearly', now: NOW });
    expect(v).toEqual({ grant: false, reason: 'not_validated', retryable: true });
  });

  it('rejects a validated receipt whose store expiry has already passed (lapsed sub restore)', () => {
    const v = receiptVerdict({
      outcome: 'valid',
      storeExpiry: new Date(NOW.getTime() - 1000),
      productId: 'quotemate_pro_monthly',
      now: NOW,
    });
    expect(v).toEqual({ grant: false, reason: 'expired', retryable: false });
  });

  it('rejects a validated receipt expiring exactly now (boundary is exclusive)', () => {
    const v = receiptVerdict({ outcome: 'valid', storeExpiry: new Date(NOW), productId: 'quotemate_pro_monthly', now: NOW });
    expect(v).toEqual({ grant: false, reason: 'expired', retryable: false });
  });

  it('grants until the store expiry when validated and in the future', () => {
    const expiry = new Date(NOW.getTime() + 30 * 86400000);
    const v = receiptVerdict({ outcome: 'valid', storeExpiry: expiry, productId: 'quotemate_pro_monthly', now: NOW });
    expect(v).toEqual({ grant: true, expiryDate: expiry });
  });

  it('grants a 30-day fallback for a validated monthly receipt with no store expiry', () => {
    const v = receiptVerdict({ outcome: 'valid', storeExpiry: null, productId: 'quotemate_pro_monthly', now: NOW });
    expect(v).toEqual({ grant: true, expiryDate: new Date(NOW.getTime() + 30 * 86400000) });
  });

  it('grants a 365-day fallback for a validated yearly receipt with no store expiry', () => {
    const v = receiptVerdict({ outcome: 'valid', storeExpiry: null, productId: 'quotemate_pro_yearly', now: NOW });
    expect(v).toEqual({ grant: true, expiryDate: new Date(NOW.getTime() + 365 * 86400000) });
  });
});

describe('isFirstGrantOfTransaction', () => {
  const TXN = 'txn-original';
  const RENEWAL_TXN = 'txn-renewal';

  it('REGRESSION: a live sub re-validated on launch is not a new grant', () => {
    // The Aug-2026 bug: a yearly subscriber who bought six weeks earlier got a
    // fresh "💰 New Pro subscriber" admin email — and re-entered the referral
    // commission path — every time they opened the app, because the stores
    // hand a live subscription back on every launch.
    expect(isFirstGrantOfTransaction({ isPro: true, transactionId: TXN }, TXN)).toBe(false);
  });

  it('treats a renewal as a new grant — it mints a new transaction id', () => {
    expect(isFirstGrantOfTransaction({ isPro: true, transactionId: TXN }, RENEWAL_TXN)).toBe(true);
  });

  it('treats a first-ever purchase (no prior doc) as a new grant', () => {
    expect(isFirstGrantOfTransaction(undefined, TXN)).toBe(true);
    expect(isFirstGrantOfTransaction(null, TXN)).toBe(true);
    expect(isFirstGrantOfTransaction({}, TXN)).toBe(true);
  });

  it('treats a charged-but-not-entitled buyer being healed as a new grant', () => {
    // The exact shape recoverStuckPurchases.ts existed for: the id was logged
    // but isPro never got written. This buyer MUST still trigger the alert.
    expect(isFirstGrantOfTransaction({ isPro: false, transactionId: TXN }, TXN)).toBe(true);
  });

  it('fails open when either id is missing — a duplicate alert beats a silent sale', () => {
    expect(isFirstGrantOfTransaction({ isPro: true }, TXN)).toBe(true);
    expect(isFirstGrantOfTransaction({ isPro: true, transactionId: '' }, TXN)).toBe(true);
    expect(isFirstGrantOfTransaction({ isPro: true, transactionId: 123 }, TXN)).toBe(true);
    expect(isFirstGrantOfTransaction({ isPro: true, transactionId: TXN }, '')).toBe(true);
  });

  it('does not treat a truthy-but-not-true isPro as an existing entitlement', () => {
    expect(isFirstGrantOfTransaction({ isPro: 'yes', transactionId: TXN }, TXN)).toBe(true);
  });
});
