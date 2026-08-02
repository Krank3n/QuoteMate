import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory AsyncStorage.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { store.delete(k); }),
  },
}));

const callable = vi.fn();
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => callable),
}));

import {
  applyPendingReferral,
  clearPendingReferral,
  getPendingReferral,
  storePendingReferral,
} from './pendingReferral';

const KEY = '@quotemate:pending_referral';

beforeEach(() => {
  store.clear();
  callable.mockReset();
});

describe('storePendingReferral', () => {
  it('stores a valid code from a bare code', async () => {
    expect(await storePendingReferral('qm-ab2cd3')).toBe('QM-AB2CD3');
    expect(store.get(KEY)).toBe('QM-AB2CD3');
  });

  it('stores a code extracted from a pasted/opened referral URL', async () => {
    expect(await storePendingReferral('https://quotemateapp.au/ref/QM-AB2CD3')).toBe('QM-AB2CD3');
  });

  it('refuses junk so nothing unexpected can be replayed into the callable', async () => {
    expect(await storePendingReferral('not-a-code')).toBeNull();
    expect(await storePendingReferral('')).toBeNull();
    expect(await storePendingReferral(null)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('keeps the FIRST code when a second link arrives before signup', async () => {
    await storePendingReferral('QM-AB2CD3');
    expect(await storePendingReferral('QM-XY9Z88')).toBe('QM-AB2CD3');
    expect(store.get(KEY)).toBe('QM-AB2CD3');
  });
});

describe('getPendingReferral', () => {
  it('ignores a corrupted stored value', async () => {
    store.set(KEY, 'garbage');
    expect(await getPendingReferral()).toBeNull();
  });

  it('returns a stored valid code', async () => {
    store.set(KEY, 'QM-AB2CD3');
    expect(await getPendingReferral()).toBe('QM-AB2CD3');
  });
});

describe('applyPendingReferral', () => {
  it('does nothing when no code is pending', async () => {
    expect(await applyPendingReferral()).toBe('none');
    expect(callable).not.toHaveBeenCalled();
  });

  it('applies the pending code once and clears it', async () => {
    await storePendingReferral('QM-AB2CD3');
    callable.mockResolvedValue({ data: { success: true } });

    expect(await applyPendingReferral()).toBe('applied');
    expect(callable).toHaveBeenCalledWith({ referralCode: 'QM-AB2CD3' });
    expect(await getPendingReferral()).toBeNull();
  });

  it('drops the code on a terminal rejection so it is not retried forever', async () => {
    for (const code of [
      'functions/not-found',
      'functions/invalid-argument',
      'functions/already-exists',
      'functions/failed-precondition',
      'functions/permission-denied',
    ]) {
      store.clear();
      await storePendingReferral('QM-AB2CD3');
      callable.mockRejectedValue(Object.assign(new Error('nope'), { code }));

      expect(await applyPendingReferral()).toBe('rejected');
      expect(await getPendingReferral()).toBeNull();
    }
  });

  it('keeps the code for a later retry on a transient failure', async () => {
    for (const code of ['functions/unavailable', 'functions/internal', 'functions/resource-exhausted']) {
      store.clear();
      await storePendingReferral('QM-AB2CD3');
      callable.mockRejectedValue(Object.assign(new Error('flaky'), { code }));

      expect(await applyPendingReferral()).toBe('retry');
      // Still parked — the next launch tries again.
      expect(await getPendingReferral()).toBe('QM-AB2CD3');
    }
  });

  it('treats an unauthenticated error as retryable (auth not settled yet)', async () => {
    await storePendingReferral('QM-AB2CD3');
    callable.mockRejectedValue(Object.assign(new Error('no auth'), { code: 'functions/unauthenticated' }));

    expect(await applyPendingReferral()).toBe('retry');
    expect(await getPendingReferral()).toBe('QM-AB2CD3');
  });
});

describe('clearPendingReferral', () => {
  it('removes a parked code', async () => {
    await storePendingReferral('QM-AB2CD3');
    await clearPendingReferral();
    expect(await getPendingReferral()).toBeNull();
  });
});
