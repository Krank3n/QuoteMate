/**
 * Regression tests for the CallKatie dashboard promo dismissal.
 *
 * The card used to remember a dismissal only in device-local AsyncStorage, so
 * a reinstall or a new device brought it back. Dismissal now also writes to
 * the account-level `users/{uid}/settings/promos` doc, and `shouldShowPromo`
 * falls back to that doc (once per session) when the local flags are absent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const local = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => local.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      local.store.set(key, value);
    }),
  },
}));

const firestore = vi.hoisted(() => ({
  setDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ data: () => undefined })),
  docPaths: [] as string[],
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => {
    const path = segments.join('/');
    firestore.docPaths.push(path);
    return { path };
  }),
  getDoc: firestore.getDoc,
  setDoc: firestore.setDoc,
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn(async () => ({}))),
}));

const DISMISSED_KEY = '@quotemate/leadsPromoDismissed';
const SUBMITTED_KEY = '@quotemate/leadsInterestSubmitted';

// vi.resetModules() gives each test a fresh leadInterest (clearing its
// session memo) AND a fresh config/firebase stub (aliased to
// src/test/stubs/firebase.ts, currentUser = test-uid), so `auth` must be
// re-imported alongside the module for mutations to be visible to it.
async function importFresh() {
  vi.resetModules();
  const mod = await import('./leadInterest');
  const { auth } = await import('../config/firebase');
  return { ...mod, auth };
}

beforeEach(() => {
  local.store.clear();
  firestore.docPaths.length = 0;
  firestore.setDoc.mockClear();
  firestore.getDoc.mockClear();
  firestore.getDoc.mockImplementation(async () => ({ data: () => undefined }));
});

describe('dismissPromo', () => {
  it('writes the local flag and the account-level promos doc', async () => {
    const { dismissPromo } = await importFresh();
    await dismissPromo();

    expect(local.store.get(DISMISSED_KEY)).toBe('1');
    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/test-uid/settings/promos' }),
      { leadsPromoDismissed: true },
      { merge: true },
    );
  });

  it('still sets the local flag when signed out or the account write fails', async () => {
    const signedOut = await importFresh();
    signedOut.auth.currentUser = null;
    await signedOut.dismissPromo();
    expect(local.store.get(DISMISSED_KEY)).toBe('1');
    expect(firestore.setDoc).not.toHaveBeenCalled();

    local.store.clear();
    firestore.setDoc.mockRejectedValueOnce(new Error('offline'));
    const fresh = await importFresh();
    await expect(fresh.dismissPromo()).resolves.toBeUndefined();
    expect(local.store.get(DISMISSED_KEY)).toBe('1');
  });
});

describe('markInterestSubmitted', () => {
  it('writes the local flag and the account-level promos doc', async () => {
    const { markInterestSubmitted } = await importFresh();
    await markInterestSubmitted();

    expect(local.store.get(SUBMITTED_KEY)).toBe('1');
    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/test-uid/settings/promos' }),
      { leadsInterestSubmitted: true },
      { merge: true },
    );
  });
});

describe('shouldShowPromo', () => {
  it('hides on the local flag without touching Firestore', async () => {
    local.store.set(DISMISSED_KEY, '1');
    const { shouldShowPromo } = await importFresh();
    expect(await shouldShowPromo()).toBe(false);
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('hides when the account doc says dismissed (reinstall) and backfills the local flag', async () => {
    firestore.getDoc.mockResolvedValue({
      data: () => ({ leadsPromoDismissed: true }),
    });
    const { shouldShowPromo } = await importFresh();

    expect(await shouldShowPromo()).toBe(false);
    expect(local.store.get(DISMISSED_KEY)).toBe('1');
  });

  it('hides when the account doc says interest was submitted on another device', async () => {
    firestore.getDoc.mockResolvedValue({
      data: () => ({ leadsInterestSubmitted: true }),
    });
    const { shouldShowPromo } = await importFresh();

    expect(await shouldShowPromo()).toBe(false);
    expect(local.store.get(SUBMITTED_KEY)).toBe('1');
  });

  it('shows when neither local nor account flags exist, reading the account doc once per session', async () => {
    const { shouldShowPromo } = await importFresh();

    expect(await shouldShowPromo()).toBe(true);
    expect(await shouldShowPromo()).toBe(true);
    expect(firestore.getDoc).toHaveBeenCalledTimes(1);
  });

  it('shows (and retries next check) when the account read fails', async () => {
    firestore.getDoc.mockRejectedValueOnce(new Error('offline'));
    const { shouldShowPromo } = await importFresh();

    expect(await shouldShowPromo()).toBe(true);
    // Failure was not cached: the next check hits Firestore again and can
    // pick up a dismissal recorded on another device.
    firestore.getDoc.mockResolvedValue({
      data: () => ({ leadsPromoDismissed: true }),
    });
    expect(await shouldShowPromo()).toBe(false);
    expect(firestore.getDoc).toHaveBeenCalledTimes(2);
  });

  it('shows for signed-out users without reading Firestore', async () => {
    const { shouldShowPromo, auth } = await importFresh();
    auth.currentUser = null;

    expect(await shouldShowPromo()).toBe(true);
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('re-checks the account doc when a different user signs in', async () => {
    firestore.getDoc.mockResolvedValue({ data: () => undefined });
    const { shouldShowPromo, auth } = await importFresh();

    expect(await shouldShowPromo()).toBe(true);

    auth.currentUser = { uid: 'other-uid' };
    firestore.getDoc.mockResolvedValue({
      data: () => ({ leadsPromoDismissed: true }),
    });
    expect(await shouldShowPromo()).toBe(false);
    expect(firestore.getDoc).toHaveBeenCalledTimes(2);
  });
});
