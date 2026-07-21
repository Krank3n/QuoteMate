import { describe, it, expect } from 'vitest';
import { receiptVerdict } from './receiptValidation.helpers';

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
