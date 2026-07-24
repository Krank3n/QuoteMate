import { describe, expect, it } from 'vitest';
import { deriveTrialBootstrapWrite, toMillis } from './trialBootstrap.helpers';

const NOW = new Date('2026-07-24T10:00:00.000Z').getTime();
const QUOTE_AT = new Date('2026-07-24T09:30:00.000Z').getTime();

describe('deriveTrialBootstrapWrite', () => {
  it('seeds a full subscription doc when none exists (pre-1.47 client)', () => {
    const write = deriveTrialBootstrapWrite(undefined, QUOTE_AT, NOW);
    expect(write).not.toBeNull();
    expect(write!.payload).toMatchObject({
      isPro: false,
      quotesThisMonth: 1,
      freeQuotesLimit: 5,
      trialStartedAt: '2026-07-24T09:30:00.000Z',
      trialExpired: false,
    });
  });

  it('never writes entitlement keys (PAY-02 deny-list)', () => {
    const write = deriveTrialBootstrapWrite(undefined, QUOTE_AT, NOW);
    const denied = ['plan', 'platform', 'productId', 'platformFeeBps', 'subscriptionId'];
    for (const key of denied) expect(write!.payload).not.toHaveProperty(key);
  });

  it('stamps only trialStartedAt when the doc exists without one (1.47 client seed)', () => {
    const write = deriveTrialBootstrapWrite(
      { isPro: false, quotesThisMonth: 0, trialStartedAt: null },
      QUOTE_AT,
      NOW,
    );
    expect(Object.keys(write!.payload).sort()).toEqual(['syncedAt', 'trialStartedAt']);
    expect(write!.payload.trialStartedAt).toBe('2026-07-24T09:30:00.000Z');
  });

  it('is a no-op when a trial has already started (idempotent on re-fire)', () => {
    expect(
      deriveTrialBootstrapWrite({ trialStartedAt: '2026-07-01T00:00:00.000Z' }, QUOTE_AT, NOW),
    ).toBeNull();
  });

  it('is a no-op for expired trials (second quote must not restart the clock)', () => {
    expect(
      deriveTrialBootstrapWrite(
        { trialStartedAt: '2026-01-01T00:00:00.000Z', trialExpired: true },
        QUOTE_AT,
        NOW,
      ),
    ).toBeNull();
  });

  it('is a no-op for Pro users', () => {
    expect(deriveTrialBootstrapWrite({ isPro: true }, QUOTE_AT, NOW)).toBeNull();
  });

  it('falls back to now when the quote createdAt is missing or invalid', () => {
    const write = deriveTrialBootstrapWrite(undefined, NaN, NOW);
    expect(write!.payload.trialStartedAt).toBe('2026-07-24T10:00:00.000Z');
  });
});

describe('toMillis', () => {
  it('handles Firestore Timestamp-like objects', () => {
    expect(toMillis({ toMillis: () => 123 })).toBe(123);
    expect(toMillis({ toDate: () => new Date(456) })).toBe(456);
  });
  it('handles ISO strings, Dates, numbers, and garbage', () => {
    expect(toMillis('2026-07-24T09:30:00.000Z')).toBe(QUOTE_AT);
    expect(toMillis(new Date(QUOTE_AT))).toBe(QUOTE_AT);
    expect(toMillis(QUOTE_AT)).toBe(QUOTE_AT);
    expect(Number.isNaN(toMillis(null))).toBe(true);
    expect(Number.isNaN(toMillis('nonsense'))).toBe(true);
  });
});
