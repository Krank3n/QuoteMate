/**
 * The Supplier Book's cloud ↔ local plumbing.
 *
 * syncFavoritesFromCloud was a no-op for a long time: a reinstall (or a
 * second phone) showed an EMPTY supplier book while Firestore still held every
 * import, and the pricing pipeline — which only reads the local cache — went
 * quietly back to retail. These pin the merge rules, the once-per-session
 * guard, and the two offline traps: a cache-backed (empty) read must not
 * latch the guard, and a write that never acks must not hold the local write
 * hostage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  fromCache: false,
  failNextRead: false,
  hangReads: false,
  setDocCalls: [] as string[],
  hangWrites: false,
}));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: cloud.user }) }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}),
  collection: (_db: unknown, path: string) => path,
  doc: vi.fn((_db: unknown, path: string) => path),
  setDoc: vi.fn((path: string) => {
    cloud.setDocCalls.push(path);
    return cloud.hangWrites ? new Promise<void>(() => {}) : Promise.resolve();
  }),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  deleteDoc: vi.fn(async () => {}),
  getDocs: vi.fn((path: string) => {
    cloud.reads += 1;
    if (cloud.hangReads) return new Promise(() => {});
    if (cloud.failNextRead) {
      cloud.failNextRead = false;
      return Promise.reject(new Error('unavailable'));
    }
    expect(path).toBe('users/u1/materialFavorites');
    return Promise.resolve({ docs: cloud.docs, metadata: { fromCache: cloud.fromCache } });
  }),
}));
// materialFavorites reaches into the store only for logSyncError; the real
// store drags the whole app graph in.
vi.mock('../store/useStore', () => ({ logSyncError: vi.fn() }));

import {
  bulkSaveFavorites,
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
  cloud.fromCache = false;
  cloud.failNextRead = false;
  cloud.hangReads = false;
  cloud.setDocCalls = [];
  cloud.hangWrites = false;
  resetFavoritesSyncForTests();
});

afterEach(() => {
  vi.useRealTimers();
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

    await syncFavoritesFromCloud();

    const local = await loadFavoritesFromLocal();
    expect(Object.keys(local).sort()).toEqual(['colorbond_sheet', 'fence_post']);
    // The write stamp is not part of the mapping.
    expect((local.colorbond_sheet as Record<string, unknown>).savedAt).toBeUndefined();
    expect(local.fence_post.price).toBe(32);
  });

  it('reads the collection once per uid per session', async () => {
    cloud.docs = [cloudDoc('a', fav('A'))];
    await syncFavoritesFromCloud();
    await syncFavoritesFromCloud();
    await syncFavoritesFromCloud();
    expect(cloud.reads).toBe(1);
  });

  it('concurrent first callers share one read', async () => {
    cloud.docs = [cloudDoc('a', fav('A'))];
    await Promise.all([syncFavoritesFromCloud(), syncFavoritesFromCloud(), syncFavoritesFromCloud()]);
    expect(cloud.reads).toBe(1);
    expect(Object.keys(await loadFavoritesFromLocal())).toEqual(['a']);
  });

  it('does nothing signed out', async () => {
    cloud.user = null;
    cloud.docs = [cloudDoc('a', fav('A'))];
    await syncFavoritesFromCloud();
    expect(cloud.reads).toBe(0);
    expect(store.has(KEY)).toBe(false);
  });

  it('a rejected read never throws, and the next call retries', async () => {
    cloud.docs = [cloudDoc('a', fav('A'))];
    cloud.failNextRead = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(syncFavoritesFromCloud()).resolves.toBeUndefined();
    warn.mockRestore();

    await syncFavoritesFromCloud();
    expect(cloud.reads).toBe(2);
    expect(Object.keys(await loadFavoritesFromLocal())).toEqual(['a']);
  });

  it('an offline, cache-backed read does not latch the session as synced', async () => {
    // With no signal the SDK RESOLVES getDocs from its (memory-only, so
    // empty) cache instead of rejecting. Treating that as "synced" would
    // lock the whole session into an empty book — the very bug being fixed.
    cloud.fromCache = true;
    await syncFavoritesFromCloud();
    expect(cloud.reads).toBe(1);
    expect(store.has(KEY)).toBe(false);

    cloud.fromCache = false;
    cloud.docs = [cloudDoc('a', fav('A'))];
    await syncFavoritesFromCloud();
    expect(cloud.reads).toBe(2);
    expect(Object.keys(await loadFavoritesFromLocal())).toEqual(['a']);
  });

  it('never drops a local-only entry and leaves the cache untouched when nothing changed', async () => {
    store.set(KEY, JSON.stringify({ local_only: fav('Local only') }));
    cloud.docs = [cloudDoc('local_only', fav('Local only'))];
    await syncFavoritesFromCloud();
    expect(Object.keys(await loadFavoritesFromLocal())).toEqual(['local_only']);
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

  it('prices from what it has when the pull hangs, instead of stalling the pipeline', async () => {
    vi.useFakeTimers();
    store.set(KEY, JSON.stringify({ local: fav('Local rate') }));
    cloud.hangReads = true;

    const pending = loadAllFavoritesForLLM();
    await vi.advanceTimersByTimeAsync(2_500);
    const rates = await pending;

    expect(rates.map((r) => r.productName)).toEqual(['Local rate']);
  });
});

describe('bulkSaveFavorites', () => {
  it('writes the local cache before — and regardless of — the cloud push', async () => {
    // Offline, setDoc never acks. The local write must not wait behind it,
    // or a correction made with no signal is lost when the app is killed.
    cloud.hangWrites = true;
    await bulkSaveFavorites([{ productName: 'Merbau decking', price: 9.35, unit: 'm', isPersonalRate: true }]);

    const local = await loadFavoritesFromLocal();
    expect(local.merbau_decking).toMatchObject({ productName: 'Merbau decking', price: 9.35, isPersonalRate: true });
    expect(cloud.setDocCalls).toEqual(['users/u1/materialFavorites/merbau_decking']);
  });

  it('a second save sees the first, so queued offline saves never clobber each other', async () => {
    cloud.hangWrites = true;
    await bulkSaveFavorites([{ productName: 'Post', price: 32 }]);
    await bulkSaveFavorites([{ productName: 'Rail', price: 18 }]);
    expect(Object.keys(await loadFavoritesFromLocal()).sort()).toEqual(['post', 'rail']);
  });

  it('a corrected price updates an imported entry but keeps its supplier and keywords', async () => {
    store.set(
      KEY,
      JSON.stringify({
        // Slug keys keep the dot: only whitespace and slashes are folded.
        'r2.5_batts': fav('R2.5 batts', { store: 'Insulation Depot', price: 44, unit: 'pack', keywords: ['batts', 'insulation'], source: 'imported' }),
      }),
    );
    const result = await bulkSaveFavorites([
      { productName: 'R2.5 batts', price: 48, unit: 'pack', isPersonalRate: true, source: 'manual', store: 'manual' },
    ]);
    expect(result).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect((await loadFavoritesFromLocal())['r2.5_batts']).toMatchObject({
      price: 48,
      store: 'Insulation Depot',
      keywords: ['batts', 'insulation'],
      isPersonalRate: true,
    });
  });

  it('drops stale coverage when the unit changes, keeps it when the unit is the same', async () => {
    store.set(
      KEY,
      JSON.stringify({
        batts: fav('Batts', { price: 44, unit: 'pack', coveragePerUnit: 8.7, coverageUnit: 'm²' }),
      }),
    );
    await bulkSaveFavorites([{ productName: 'Batts', price: 46, unit: 'pack' }]);
    expect((await loadFavoritesFromLocal()).batts).toMatchObject({ price: 46, coveragePerUnit: 8.7, coverageUnit: 'm²' });

    await bulkSaveFavorites([{ productName: 'Batts', price: 6, unit: 'm²' }]);
    const changed = (await loadFavoritesFromLocal()).batts;
    expect(changed.price).toBe(6);
    expect(changed.unit).toBe('m²');
    expect(changed.coveragePerUnit).toBeUndefined();
    expect(changed.coverageUnit).toBeUndefined();
  });
});
