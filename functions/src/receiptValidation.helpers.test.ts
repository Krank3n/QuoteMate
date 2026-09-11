import { describe, it, expect } from 'vitest';
import {
  receiptVerdict,
  isFirstGrantOfTransaction,
  isNewSubscriber,
  staleSubscriptionAction,
  IAP_GRACE_MS,
  IAP_UNVERIFIED_BACKSTOP_MS,
} from './receiptValidation.helpers';

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

describe('isFirstGrantOfTransaction — re-grant after the expiry sweep', () => {
  const TXN = 'GPA.3338-8160-7569-98540';
  const TOKEN = 'play-token-stable-for-life';

  it('REGRESSION (Sep 2026): a sub the sweep expired, re-validated with the SAME transaction, is not a new grant', () => {
    // Tech Flow Electrical: Play renewed on the 3rd, phone unopened, sweep
    // flipped isPro:false on the 6th, launch sweep re-posted the same
    // transaction on the 11th → "💰 New Pro subscriber" for a 5-week-old sub.
    const prior = { isPro: false, transactionId: TXN, purchaseToken: TOKEN, expiredAt: new Date(), expiredReason: 'iap-period-ended-android' };
    expect(isFirstGrantOfTransaction(prior, TXN, TOKEN)).toBe(false);
  });

  it('matches on the purchase token alone when the transaction id has changed', () => {
    const prior = { isPro: false, transactionId: 'GPA.old', purchaseToken: TOKEN, expiredReason: 'iap-period-ended-android' };
    expect(isFirstGrantOfTransaction(prior, 'GPA.old..1', TOKEN)).toBe(false);
  });

  it('an admin-revoked sub re-validated with the same sale is a re-grant, not a first grant', () => {
    expect(isFirstGrantOfTransaction({ isPro: false, transactionId: TXN, revokedAt: new Date() }, TXN)).toBe(false);
  });

  it('still alerts on a charged-but-never-entitled buyer (same id, no expiry marker)', () => {
    expect(isFirstGrantOfTransaction({ isPro: false, transactionId: TXN }, TXN)).toBe(true);
  });

  it('an expired sub coming back on a DIFFERENT sale is a new grant', () => {
    const prior = { isPro: false, transactionId: TXN, purchaseToken: TOKEN, expiredReason: 'iap-period-ended-android' };
    expect(isFirstGrantOfTransaction(prior, 'GPA.brand-new', 'other-token')).toBe(true);
  });

  it('a live sub re-validated on launch still is not a new grant (token match)', () => {
    expect(isFirstGrantOfTransaction({ isPro: true, transactionId: TXN, purchaseToken: TOKEN }, TXN, TOKEN)).toBe(false);
  });
});

describe('isNewSubscriber', () => {
  it('a first-ever doc is a new subscriber', () => {
    expect(isNewSubscriber(undefined, { transactionId: 't1' })).toBe(true);
    expect(isNewSubscriber({}, { transactionId: 't1' })).toBe(true);
  });

  it('an Apple renewal (new transactionId, same originalTransactionId) is NOT a new subscriber', () => {
    const prior = { isPro: true, transactionId: 'apple-1', originalTransactionId: 'apple-1', purchaseToken: 'jws-1' };
    expect(isNewSubscriber(prior, { transactionId: 'apple-2', originalTransactionId: 'apple-1', purchaseToken: 'jws-2' })).toBe(false);
  });

  it('a Play re-validation on the same purchase token is NOT a new subscriber, whatever isPro says', () => {
    const prior = { isPro: false, transactionId: 'GPA.1', purchaseToken: 'tok', expiredReason: 'iap-period-ended-android' };
    expect(isNewSubscriber(prior, { transactionId: 'GPA.1', purchaseToken: 'tok' })).toBe(false);
    expect(isNewSubscriber(prior, { transactionId: 'GPA.1..2', purchaseToken: 'tok' })).toBe(false);
  });

  it('a different subscription on an existing doc IS a new subscriber', () => {
    const prior = { isPro: false, transactionId: 'GPA.1', purchaseToken: 'tok', originalTransactionId: 'apple-1' };
    expect(isNewSubscriber(prior, { transactionId: 'GPA.9', purchaseToken: 'tok-9', originalTransactionId: 'apple-9' })).toBe(true);
  });
});

describe('staleSubscriptionAction', () => {
  const NOW = Date.parse('2026-09-06T14:30:00Z');
  const RENEWED_ON_3RD = Date.parse('2026-09-03T05:10:50Z');
  const NEXT_END = new Date('2026-10-03T05:10:50Z');

  it('keeps a sub still inside the grace window without asking the store', () => {
    expect(staleSubscriptionAction({ periodEndMs: NOW - IAP_GRACE_MS + 60_000, nowMs: NOW, store: null }))
      .toEqual({ action: 'keep', reason: 'not_stale' });
  });

  it('keeps a sub with no recorded period end', () => {
    expect(staleSubscriptionAction({ periodEndMs: null, nowMs: NOW, store: null }).action).toBe('keep');
  });

  it('REGRESSION (Sep 2026): the store says the sub renewed → record the new period end, stay Pro', () => {
    const store = { outcome: 'valid' as const, expiryDate: NEXT_END, detail: 'live' };
    expect(staleSubscriptionAction({ periodEndMs: RENEWED_ON_3RD, nowMs: NOW, store }))
      .toEqual({ action: 'renew', expiryDate: NEXT_END });
  });

  it('expires when the store confirms the sub lapsed', () => {
    expect(staleSubscriptionAction({ periodEndMs: RENEWED_ON_3RD, nowMs: NOW, store: { outcome: 'invalid', expiryDate: null, detail: 'lapsed' } }))
      .toEqual({ action: 'expire', reason: 'store_confirmed' });
    const pastExpiry = { outcome: 'valid' as const, expiryDate: new Date(NOW - 1000), detail: 'live' };
    expect(staleSubscriptionAction({ periodEndMs: RENEWED_ON_3RD, nowMs: NOW, store: pastExpiry }))
      .toEqual({ action: 'expire', reason: 'store_confirmed' });
  });

  it('keeps a sub the store calls live even when it gives no expiry', () => {
    expect(staleSubscriptionAction({ periodEndMs: RENEWED_ON_3RD, nowMs: NOW, store: { outcome: 'valid', expiryDate: null, detail: 'active_without_future_expiry' } }))
      .toEqual({ action: 'keep', reason: 'store_live_no_expiry' });
  });

  it('store unreachable: keeps the sub until the backstop, then expires anyway', () => {
    const store = { outcome: 'unavailable' as const, expiryDate: null, detail: 'http_503' };
    expect(staleSubscriptionAction({ periodEndMs: RENEWED_ON_3RD, nowMs: NOW, store }))
      .toEqual({ action: 'keep', reason: 'store_unavailable_within_backstop' });
    expect(staleSubscriptionAction({ periodEndMs: NOW - IAP_UNVERIFIED_BACKSTOP_MS, nowMs: NOW, store }))
      .toEqual({ action: 'expire', reason: 'unverified_backstop' });
  });

  it('nothing to ask the store with → expires as the old sweep did', () => {
    expect(staleSubscriptionAction({ periodEndMs: RENEWED_ON_3RD, nowMs: NOW, store: null }))
      .toEqual({ action: 'expire', reason: 'unchecked' });
  });
});
