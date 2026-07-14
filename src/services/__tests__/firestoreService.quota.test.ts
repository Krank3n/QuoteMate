/**
 * Regression tests for checkAndIncrementQuota.
 *
 * The trial-expired branch used to return `allowed: false`, which made
 * duplicateQuote (and any save-without-draft path) throw TRIAL_EXPIRED for
 * free-tier users — contradicting the freemium design where quote creation
 * is unlimited on every tier and the paid gate is on sending.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runTransactionMock } = vi.hoisted(() => ({
  runTransactionMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ path: 'users/test-user/profile/subscription' })),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  runTransaction: runTransactionMock,
  increment: vi.fn(),
  Timestamp: { fromDate: vi.fn(), now: vi.fn() },
}));

vi.mock('../../config/firebase', () => ({
  auth: { currentUser: { uid: 'test-user' } },
  db: {},
  storage: {},
  functions: {},
}));

import { firestoreService } from '../firestoreService';
import { TRIAL_MS } from '../../utils/trialConfig';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Wire runTransaction to hand the callback a fake transaction over one subscription doc. */
function primeSubscriptionDoc(data: Record<string, unknown> | null) {
  const setSpy = vi.fn();
  runTransactionMock.mockImplementation(async (_db, callback) =>
    callback({
      get: async () => ({ exists: () => data !== null, data: () => data }),
      set: setSpy,
    }),
  );
  return setSpy;
}

function subscriptionDoc(overrides: Record<string, unknown>) {
  const now = Date.now();
  return {
    isPro: false,
    quotesThisMonth: 3,
    currentPeriodStart: new Date(now - 5 * DAY_MS).toISOString(),
    currentPeriodEnd: new Date(now + 5 * DAY_MS).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  runTransactionMock.mockReset();
});

describe('checkAndIncrementQuota', () => {
  it('allows creation after the trial expired (free tier) and still counts the quote', async () => {
    const setSpy = primeSubscriptionDoc(
      subscriptionDoc({ trialStartedAt: new Date(Date.now() - TRIAL_MS - DAY_MS).toISOString() }),
    );

    const result = await firestoreService.checkAndIncrementQuota();

    expect(result.allowed).toBe(true);
    expect(result.trialExpired).toBe(true);
    expect(result.isPro).toBe(false);
    expect(result.quotesThisMonth).toBe(4);
    expect(setSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quotesThisMonth: 4 }),
    );
  });

  it('allows creation during an active trial and reports days remaining', async () => {
    const setSpy = primeSubscriptionDoc(
      subscriptionDoc({ trialStartedAt: new Date(Date.now() - 2 * DAY_MS).toISOString() }),
    );

    const result = await firestoreService.checkAndIncrementQuota();

    expect(result.allowed).toBe(true);
    expect(result.trialExpired).toBe(false);
    expect(result.quotesThisMonth).toBe(4);
    expect(result.trialDaysRemaining).toBe(12);
    expect(setSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quotesThisMonth: 4 }),
    );
  });

  it('starts the trial on the first quote when no trialStartedAt exists', async () => {
    const setSpy = primeSubscriptionDoc(subscriptionDoc({ quotesThisMonth: 0 }));

    const result = await firestoreService.checkAndIncrementQuota();

    expect(result.allowed).toBe(true);
    expect(result.trialExpired).toBe(false);
    expect(result.trialStartedAt).toBeTruthy();
    expect(setSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quotesThisMonth: 1, trialStartedAt: expect.any(String) }),
    );
  });

  it('allows pro users regardless of trial state', async () => {
    primeSubscriptionDoc(
      subscriptionDoc({
        isPro: true,
        trialStartedAt: new Date(Date.now() - TRIAL_MS - DAY_MS).toISOString(),
      }),
    );

    const result = await firestoreService.checkAndIncrementQuota();

    expect(result.allowed).toBe(true);
    expect(result.isPro).toBe(true);
    expect(result.quotesThisMonth).toBe(4);
  });
});
