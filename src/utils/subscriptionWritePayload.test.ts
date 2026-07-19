import { describe, it, expect } from 'vitest';
import { SubscriptionStatus } from '../types';
import {
  CLIENT_SUBSCRIPTION_WRITABLE_KEYS,
  clientSubscriptionWritePayload,
} from './subscriptionWritePayload';

const proStatus: SubscriptionStatus = {
  isPro: true,
  plan: 'pro',
  quotesThisMonth: 3,
  currentPeriodStart: new Date('2026-07-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-07-31T23:59:59Z'),
  freeQuotesLimit: 5,
  trialStartedAt: new Date('2026-06-20T00:00:00Z'),
  trialExpired: false,
  dismissedUpgradeBanner: true,
  platformFeeBps: 100,
};

describe('clientSubscriptionWritePayload (PAY-02)', () => {
  it('never contains entitlement fields, even for a Pro status — regression for the client isPro upload', () => {
    const payload = clientSubscriptionWritePayload(proStatus);
    for (const key of ['isPro', 'plan', 'platformFeeBps', 'platform', 'productId', 'transactionId', 'purchaseToken', 'appleValidated', 'googleValidated', 'subscriptionId', 'cancelAtPeriodEnd']) {
      expect(payload, `payload must not contain ${key}`).not.toHaveProperty(key);
    }
  });

  it('contains exactly the rules-allow-listed keys', () => {
    const payload = clientSubscriptionWritePayload(proStatus);
    expect(Object.keys(payload).sort()).toEqual([...CLIENT_SUBSCRIPTION_WRITABLE_KEYS].sort());
  });

  it('serialises dates as ISO strings and preserves quota/trial values', () => {
    const payload = clientSubscriptionWritePayload(proStatus);
    expect(payload.quotesThisMonth).toBe(3);
    expect(payload.currentPeriodStart).toBe('2026-07-01T00:00:00.000Z');
    expect(payload.currentPeriodEnd).toBe('2026-07-31T23:59:59.000Z');
    expect(payload.trialStartedAt).toBe('2026-06-20T00:00:00.000Z');
    expect(payload.dismissedUpgradeBanner).toBe(true);
    expect(typeof payload.syncedAt).toBe('string');
  });

  it('writes trialStartedAt as null (not undefined) when the trial has not started', () => {
    const payload = clientSubscriptionWritePayload({ ...proStatus, trialStartedAt: undefined });
    expect(payload.trialStartedAt).toBeNull();
  });

  it('tolerates ISO-string dates from AsyncStorage round-trips', () => {
    const stored = {
      ...proStatus,
      currentPeriodStart: '2026-07-01T00:00:00.000Z',
      currentPeriodEnd: '2026-07-31T23:59:59.000Z',
    } as unknown as SubscriptionStatus;
    const payload = clientSubscriptionWritePayload(stored);
    expect(payload.currentPeriodStart).toBe('2026-07-01T00:00:00.000Z');
  });
});
