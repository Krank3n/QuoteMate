/**
 * syncFavoritesFromCloud was a no-op for a long time: a reinstall (or a
 * second phone) showed an EMPTY supplier book while Firestore still held every
 * import, and the pricing pipeline — which only reads the local cache — went
 * quietly back to retail. These pin the merge rules and the once-per-session
 * guard so the fix can't regress into either "never syncs" or "re-reads the
 * whole collection on every keystroke".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { store.delete(k); }),
  },
}));

const cloud = vi.hoisted(() => ({
  user: { uid: 'u1' } as { uid: string } | null,
  docs: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
  reads: 0,
  failNextRead: false,
}));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: cloud.user }) }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}),
  collection: (_db: unknown, path: string) => path,
  doc: vi.fn((_db: unknown, path: string) => path),
  setDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  deleteDoc: vi.fn(async () => {}),
  getDocs: vi.fn(async (path: string) => {
    cloud.reads += 1;
    if (cloud.failNextRead) {
      cloud.failNextRead = false;
      throw new Error('unavailable');
    }
    expect(path).toBe('users/u1/materialFavorites');
    return { docs: cloud.docs };
  }),
}));
// materialFavorites reaches into the store only for logSyncError; the real
// store drags the whole app graph in.
vi.mock('../store/useStore', () => ({ logSyncError: vi.fn() }));

import {
  loadAllFavoritesForLLM,
  loadFavoritesFromLocal,
  mergeCloudFavorites,
  resetFavoritesSyncForTests,
  syncFavoritesFromCloud,
} from './materialFavorites';
import type { FavoriteProductMapping } from '../types';

const KEY = 'material_favorites';

function fav(productName: string, extra: Partial<FavoriteProductMapping> = {}): FavoriteProductMapping {
  return { productName, store: 'Metro Fencing', price: 40, unit: 'each', isPersonalRate: true, ...extra };
}

function cloudDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

beforeEach(() => {
  store.clear();
  cloud.user = { uid: 'u1' };
  cloud.docs = [];
  cloud.reads = 0;
  cloud.failNextRead = false;
  resetFavoritesSyncForTests();
});

describe('mergeCloudFavorites', () => {
  it('adds cloud-only entries and keeps local-only ones', () => {
    const { merged, added, updated } = mergeCloudFavorites(
      { local_only: fav('Local only') },
      { cloud_only: fav('Cloud only') },
    );
    expect(Object.keys(merged).sort()).toEqual(['cloud_only', 'local_only']);
    expect(added).toBe(1);
    expect(updated).toBe(0);
  });

  it('lets a strictly newer cloud entry replace the local one', () => {
    const { merged, updated } = mergeCloudFavorites(
      { post: fav('Post', { price: 40, lastUpdatedAt: '2026-08-01T00:00:00.000Z' }) },
      { post: fav('Post', { price: 44, lastUpdatedAt: '2026-08-02T00:00:00.000Z' }) },
    );
    expect(merged.post.price).toBe(44);
    expect(updated).toBe(1);
  });

  it('keeps the local entry when it is newer, equal, or neither side is dated', () => {
    const newerLocal = mergeCloudFavorites(
      { post: fav('Post', { price: 40, lastUpdatedAt: '2026-08-03T00:00:00.000Z' }) },
      { post: fav('Post', { price: 44, lastUpdatedAt: '2026-08-02T00:00:00.000Z' }) },
    );
    expect(newerLocal.merged.post.price).toBe(40);
    expect(newerLocal.updated).toBe(0);

    const undated = mergeCloudFavorites({ post: fav('Post', { price: 40 }) }, { post: fav('Post', { price: 44 }) });
    expect(undated.merged.post.price).toBe(40);
    expect(undated.updated).toBe(0);
  });

  it('skips a cloud document with no product name', () => {
    const { merged, added } = mergeCloudFavorites({}, { junk: { store: 'x' } as FavoriteProductMapping });
    expect(merged).toEqual({});
    expect(added).toBe(0);
  });
});

describe('syncFavoritesFromCloud', () => {
  it('pulls the cloud book into an empty local cache — the reinstall case', async () => {
    cloud.docs = [
      cloudDoc('colorbond_sheet', { ...fav('Colorbond sheet'), savedAt: '2026-08-01T00:00:00.000Z' }),
      cloudDoc('fence_post', fav('Fence post', { price: 32 })),
    ];

    const result = await syncFavoritesFromCloud();

    expect(result).toEqual({ added: 2, updated: 0, skipped: false });
    const local = await loadFavoritesFromLocal();
    expect(Object.keys(local).sort()).toEqual(['colorbond_sheet', 'fence_post']);
    // The write stamp is not part of the mapping.
    expect((local.colorbond_sheet as Record<string, unknown>).savedAt).toBeUndefined();
    expect(local.fence_post.price).toBe(32);
  });

  it('reads the collection once per uid per session, and again on force', async () => {
    cloud.docs = [cloudDoc('a', fav('A'))];
    await syncFavoritesFromCloud();
    const second = await syncFavoritesFromCloud();
    expect(second.skipped).toBe(true);
    expect(cloud.reads).toBe(1);

    cloud.docs = [cloudDoc('a', fav('A')), cloudDoc('b', fav('B'))];
    const forced = await syncFavoritesFromCloud({ force: true });
    expect(forced).toEqual({ added: 1, updated: 0, skipped: false });
    expect(cloud.reads).toBe(2);
  });

  it('does nothing signed out', async () => {
    cloud.user = null;
    cloud.docs = [cloudDoc('a', fav('A'))];
    expect(await syncFavoritesFromCloud()).toEqual({ added: 0, updated: 0, skipped: true });
    expect(cloud.reads).toBe(0);
    expect(store.has(KEY)).toBe(false);
  });

  it('a failed read leaves the guard unset so the next call retries', async () => {
    cloud.docs = [cloudDoc('a', fav('A'))];
    cloud.failNextRead = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await syncFavoritesFromCloud()).skipped).toBe(true);
    warn.mockRestore();

    const retry = await syncFavoritesFromCloud();
    expect(retry).toEqual({ added: 1, updated: 0, skipped: false });
    expect(cloud.reads).toBe(2);
  });

  it('never drops a local-only entry and leaves the cache untouched when nothing changed', async () => {
    store.set(KEY, JSON.stringify({ local_only: fav('Local only') }));
    cloud.docs = [cloudDoc('local_only', fav('Local only'))];
    const result = await syncFavoritesFromCloud();
    expect(result).toEqual({ added: 0, updated: 0, skipped: false });
    expect(Object.keys(await loadFavoritesFromLocal())).toEqual(['local_only']);
  });

  it('a second uid on the same device gets its own pull', async () => {
    cloud.docs = [cloudDoc('a', fav('A'))];
    await syncFavoritesFromCloud();
    cloud.user = { uid: 'u2' };
    // The mocked getDocs asserts the path; swap the expectation for u2.
    const { getDocs } = await import('firebase/firestore');
    (getDocs as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      cloud.reads += 1;
      return { docs: [] };
    });
    expect((await syncFavoritesFromCloud()).skipped).toBe(false);
    expect(cloud.reads).toBe(2);
  });
});

describe('loadAllFavoritesForLLM', () => {
  it('sees the cloud book on a fresh install', async () => {
    cloud.docs = [
      cloudDoc('batts', fav('R2.5 HD Insulation Batts', { price: 48, unit: 'pack' })),
      cloudDoc('starred', { productName: 'Starred retail product', store: 'Bunnings', price: 9 }),
    ];
    const rates = await loadAllFavoritesForLLM();
    expect(rates.map((r) => r.productName)).toEqual(['R2.5 HD Insulation Batts']);
    expect(cloud.reads).toBe(1);
  });
});
