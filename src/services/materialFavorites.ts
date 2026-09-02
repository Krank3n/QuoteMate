/**
 * Material Favorites Storage Service
 *
 * Manages user's favorite product mappings with local + cloud sync.
 * When a user selects a product for a material, it can be saved as a favorite
 * so future quotes automatically use that product.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, collection } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { FavoriteProductMapping } from '../types';
import { logSyncError } from '../store/useStore';

// Also listed by name in useStore.clearAllData (sign-out), which can't import
// this module without a cycle. Keep the two in step.
const FAVORITES_STORAGE_KEY = 'material_favorites';
/** How long the pricing pipeline waits for a first cloud pull before pricing from what it has. */
const SYNC_WAIT_MS = 2_500;

/**
 * Generate a unique key for a material (used for storage)
 */
function getMaterialKey(materialName: string, searchTerm?: string): string {
  const key = searchTerm || materialName;
  return key.toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '-');
}

/**
 * Firestore rejects writes that contain `undefined` field values. Imported
 * supplier-list items are sparse (no productUrl/itemNumber/imageUrl/etc.) so
 * we strip undefineds before every setDoc to keep the sync from failing.
 */
function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as any)[k] = v;
  }
  return out;
}

/**
 * Load all favorites from local storage
 */
export async function loadFavoritesFromLocal(): Promise<
  Record<string, FavoriteProductMapping>
> {
  try {
    const stored = await AsyncStorage.getItem(FAVORITES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[favorites] failed to load from AsyncStorage', error);
    return {};
  }
}

/**
 * Save all favorites to local storage
 */
async function saveFavoritesToLocal(
  favorites: Record<string, FavoriteProductMapping>
): Promise<void> {
  try {
    await AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[favorites] failed to write to AsyncStorage', error);
  }
}

/**
 * Get a favorite product for a material (checks local first, then cloud)
 */
export async function getFavoriteProduct(
  materialName: string,
  searchTerm?: string
): Promise<FavoriteProductMapping | null> {
  const key = getMaterialKey(materialName, searchTerm);

  // Check local storage first (fast)
  const localFavorites = await loadFavoritesFromLocal();
  if (localFavorites[key]) {
    return localFavorites[key];
  }

  // Check cloud storage (slower, but up-to-date across devices)
  try {
    const auth = getAuth();
    if (!auth.currentUser) return null;

    const db = getFirestore();
    const favDoc = await getDoc(
      doc(db, `users/${auth.currentUser.uid}/materialFavorites/${key}`)
    );

    if (favDoc.exists()) {
      const favorite = favDoc.data() as FavoriteProductMapping;
      // Update local cache
      localFavorites[key] = favorite;
      await saveFavoritesToLocal(localFavorites);
      return favorite;
    }
  } catch (error) {
    // Read failure isn't fatal — local cache is the source of truth and we'll
    // try again next time. Log it so the failure isn't completely invisible.
    // eslint-disable-next-line no-console
    console.warn(`[favorites] cloud read failed for ${key}`, error);
  }

  return null;
}

/**
 * Save a favorite product for a material (saves to both local and cloud)
 */
export async function saveFavoriteProduct(
  materialName: string,
  searchTerm: string | undefined,
  favorite: FavoriteProductMapping
): Promise<void> {
  const key = getMaterialKey(materialName, searchTerm);

  // Save to local storage
  const localFavorites = await loadFavoritesFromLocal();
  localFavorites[key] = favorite;
  await saveFavoritesToLocal(localFavorites);


  // Save to cloud (async, doesn't block)
  try {
    const auth = getAuth();
    if (!auth.currentUser) return;

    const db = getFirestore();
    await setDoc(
      doc(db, `users/${auth.currentUser.uid}/materialFavorites/${key}`),
      stripUndefined({
        ...favorite,
        savedAt: new Date().toISOString(),
      }),
      { merge: true }
    );
  } catch (error) {
    logSyncError('favorite', key, error);
  }
}

/**
 * Remove a favorite product for a material
 */
export async function removeFavoriteProduct(
  materialName: string,
  searchTerm?: string
): Promise<void> {
  const key = getMaterialKey(materialName, searchTerm);

  // Remove from local storage
  const localFavorites = await loadFavoritesFromLocal();
  delete localFavorites[key];
  await saveFavoritesToLocal(localFavorites);


  // Remove from cloud
  try {
    const auth = getAuth();
    if (!auth.currentUser) return;

    const db = getFirestore();
    await deleteDoc(doc(db, `users/${auth.currentUser.uid}/materialFavorites/${key}`));
  } catch (error) {
    logSyncError('favorite', key, error);
  }
}

/**
 * Load all personal supplier rates for the auto-generate LLM flow.
 * Returns only favorites flagged as isPersonalRate.
 */
export async function loadAllFavoritesForLLM(): Promise<FavoriteProductMapping[]> {
  // The pipeline only ever reads local; on a fresh install that is empty
  // until the cloud copy lands. Wait briefly for it, never long enough to
  // stall pricing with no signal (the SDK can sit ~10s before it gives up) —
  // the pull carries on in the background and the next run gets it.
  await Promise.race([
    syncFavoritesFromCloud(),
    new Promise<void>((resolve) => setTimeout(resolve, SYNC_WAIT_MS)),
  ]);
  const local = await loadFavoritesFromLocal();
  return Object.values(local).filter((f) => f.isPersonalRate === true);
}

/**
 * Bulk-save favorites from a supplier price list import.
 *
 * Merge policy:
 * - If an existing favorite lives at the same slug key, update price/unit/
 *   coverage/lastUpdatedAt/source/sourceRef but PRESERVE the user's
 *   `keywords` and `notes` (unless the caller passes `{ force: true }`).
 *   `store` is preserved when the existing store differs from the incoming
 *   value (user may have manually re-labelled it).
 * - If no existing favorite, create a new one.
 *
 * Returns counts suitable for a snackbar summary.
 */
export async function bulkSaveFavorites(
  items: Array<Partial<FavoriteProductMapping> & { productName: string }>,
  options?: { force?: boolean }
): Promise<{ created: number; updated: number; unchanged: number }> {
  const force = options?.force === true;
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  const localFavorites = await loadFavoritesFromLocal();
  const toPush: Array<{ key: string; merged: FavoriteProductMapping }> = [];

  // Pre-resolve auth + db once
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  const db = uid ? getFirestore() : null;

  for (const incoming of items) {
    if (!incoming.productName) continue;
    const key = getMaterialKey(incoming.productName);
    const existing = localFavorites[key];

    let merged: FavoriteProductMapping;
    let status: 'created' | 'updated' | 'unchanged' = 'created';

    if (existing && !force) {
      // Refresh existing — preserve user-edited fields.
      const nextPrice = incoming.price ?? existing.price;
      const nextUnit = incoming.unit ?? existing.unit;
      // Coverage is stated per purchase unit. When the unit itself changes
      // ("per pack" → "per m²") the old coverage no longer describes the
      // entry, and the estimator prompt would read it as fact.
      const keepCoverage = nextUnit === existing.unit;
      const nextCoveragePerUnit = incoming.coveragePerUnit ?? (keepCoverage ? existing.coveragePerUnit : undefined);
      const nextCoverageUnit = incoming.coverageUnit ?? (keepCoverage ? existing.coverageUnit : undefined);

      const priceChanged = nextPrice !== existing.price;
      const unitChanged = nextUnit !== existing.unit;
      const coverageChanged =
        nextCoveragePerUnit !== existing.coveragePerUnit ||
        nextCoverageUnit !== existing.coverageUnit;

      merged = {
        ...existing,
        price: nextPrice,
        unit: nextUnit,
        coveragePerUnit: nextCoveragePerUnit,
        coverageUnit: nextCoverageUnit,
        // Preserve user-edited fields — keywords, notes, store.
        keywords: existing.keywords ?? incoming.keywords,
        notes: existing.notes,
        store: existing.store || incoming.store || 'manual',
        // Update provenance + timestamps.
        source: incoming.source ?? existing.source,
        sourceRef: incoming.sourceRef ?? existing.sourceRef,
        isPersonalRate: incoming.isPersonalRate ?? existing.isPersonalRate,
        lastUpdatedAt: incoming.lastUpdatedAt ?? new Date().toISOString(),
      };

      status = priceChanged || unitChanged || coverageChanged ? 'updated' : 'unchanged';
    } else if (existing && force) {
      merged = {
        ...existing,
        ...incoming,
        productName: incoming.productName,
        store: incoming.store || existing.store || 'manual',
      } as FavoriteProductMapping;
      status = 'updated';
    } else {
      merged = {
        productName: incoming.productName,
        store: incoming.store || 'manual',
        productUrl: incoming.productUrl,
        itemNumber: incoming.itemNumber,
        dimensions: incoming.dimensions,
        unit: incoming.unit,
        price: incoming.price,
        imageUrl: incoming.imageUrl,
        source: incoming.source,
        sourceRef: incoming.sourceRef,
        lastUpdatedAt: incoming.lastUpdatedAt ?? new Date().toISOString(),
        isPersonalRate: incoming.isPersonalRate,
        coveragePerUnit: incoming.coveragePerUnit,
        coverageUnit: incoming.coverageUnit,
        keywords: incoming.keywords,
        notes: incoming.notes,
      };
      status = 'created';
    }

    localFavorites[key] = merged;

    if (status === 'created') created += 1;
    else if (status === 'updated') updated += 1;
    else unchanged += 1;
    if (status !== 'unchanged') toPush.push({ key, merged });
  }

  // Local FIRST. A Firestore write never acks while offline (and the SDK here
  // is memory-only, so a killed process drops it), so anything awaited behind
  // it is lost with it — an earlier version wrote local after the pushes and
  // an offline correction vanished. Local is also what every reader uses.
  await saveFavoritesToLocal(localFavorites);

  // Then the cloud, in the background: the caller has what it needs, and a
  // push that fails surfaces through logSyncError (which keeps only the most
  // recent error, so a noisy import can't spam the banner).
  if (db && uid) {
    for (const { key, merged } of toPush) {
      setDoc(
        doc(db, `users/${uid}/materialFavorites/${key}`),
        stripUndefined({
          ...merged,
          savedAt: new Date().toISOString(),
        }),
        { merge: true }
      ).catch((error) => logSyncError('favorite', key, error));
    }
  }

  return { created, updated, unchanged };
}

/**
 * Returns the unique set of supplier names already used by any saved
 * favorite. Used by the import / edit flows to suggest existing suppliers
 * so the user can consolidate items under one name instead of typing
 * slight variants. Includes any favorite with a non-empty, non-"manual"
 * store — does NOT require isPersonalRate, since older imports may not
 * have that flag set but still belong to a real supplier.
 */
export async function getExistingPersonalRateSuppliers(): Promise<string[]> {
  const local = await loadFavoritesFromLocal();
  const names = new Set<string>();
  for (const fav of Object.values(local)) {
    const store = fav.store?.trim();
    if (!store) continue;
    if (store.toLowerCase() === 'manual') continue;
    if (store.toLowerCase().includes('bunnings.com.au')) continue;
    names.add(store);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * Bulk-rename the `store` field on every favorite where `store === oldStore`.
 * Used by the Supplier Book section header rename affordance to consolidate
 * items that were imported under slightly different supplier names.
 *
 * Returns the number of favorites updated.
 */
export async function renameStoreOnFavorites(oldStore: string, newStore: string): Promise<number> {
  const trimmedNew = newStore.trim();
  if (!trimmedNew || trimmedNew === oldStore) return 0;

  const local = await loadFavoritesFromLocal();
  let updated = 0;
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  const db = uid ? getFirestore() : null;

  for (const [key, fav] of Object.entries(local)) {
    if (fav.store !== oldStore) continue;
    const next: FavoriteProductMapping = {
      ...fav,
      store: trimmedNew,
      lastUpdatedAt: new Date().toISOString(),
    };
    local[key] = next;
    updated += 1;

    if (db && uid) {
      try {
        await setDoc(
          doc(db, `users/${uid}/materialFavorites/${key}`),
          stripUndefined({ ...next, savedAt: new Date().toISOString() }),
          { merge: true }
        );
      } catch (error) {
        logSyncError('favorite', key, error);
      }
    }
  }

  if (updated > 0) {
    await saveFavoritesToLocal(local);
  }
  return updated;
}

/**
 * Delete every favorite where `store === supplierName`. Used by the
 * Supplier Book section header's "delete supplier" affordance to clear
 * out an entire supplier's items in one go.
 *
 * Returns the number of favorites removed.
 */
export async function deleteAllFavoritesByStore(supplierName: string): Promise<number> {
  const local = await loadFavoritesFromLocal();
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  const db = uid ? getFirestore() : null;
  let removed = 0;

  for (const [key, fav] of Object.entries(local)) {
    if (fav.store !== supplierName) continue;
    delete local[key];
    removed += 1;
    if (db && uid) {
      try {
        await deleteDoc(doc(db, `users/${uid}/materialFavorites/${key}`));
      } catch (error) {
        logSyncError('favorite', key, error);
      }
    }
  }

  if (removed > 0) {
    await saveFavoritesToLocal(local);
  }
  return removed;
}

/**
 * Pure merge of the cloud copy of the book into the local cache.
 *
 * Local is the read source of truth for every consumer (pricing pipeline,
 * local search, Mate's snapshot), so the cloud copy only ever ADDS to it or
 * refreshes an entry the cloud has demonstrably updated more recently:
 *   - cloud-only key → added (the reinstall / second-device case)
 *   - local-only key → kept (a cloud write that failed, or a deletion the
 *                      cloud hasn't caught up on — never silently dropped)
 *   - both           → cloud wins only when its lastUpdatedAt is strictly
 *                      newer; otherwise the local entry stands
 * Returns how many entries changed so callers can skip the AsyncStorage
 * write when nothing did.
 */
export function mergeCloudFavorites(
  local: Record<string, FavoriteProductMapping>,
  cloud: Record<string, FavoriteProductMapping>,
): { merged: Record<string, FavoriteProductMapping>; added: number; updated: number } {
  const merged: Record<string, FavoriteProductMapping> = { ...local };
  let added = 0;
  let updated = 0;
  for (const [key, remote] of Object.entries(cloud)) {
    if (!remote || !remote.productName) continue;
    const mine = merged[key];
    if (!mine) {
      merged[key] = remote;
      added += 1;
      continue;
    }
    const remoteAt = Date.parse(remote.lastUpdatedAt ?? '') || 0;
    const mineAt = Date.parse(mine.lastUpdatedAt ?? '') || 0;
    if (remoteAt > mineAt) {
      merged[key] = remote;
      updated += 1;
    }
  }
  return { merged, added, updated };
}

// One server-backed collection read per signed-in uid per app session. Every
// writer in this module keeps local current, so a second pull would return
// what we already hold. Concurrent first callers share the one read.
let syncedForUid: string | null = null;
let inFlight: Promise<void> | null = null;

export function resetFavoritesSyncForTests(): void {
  syncedForUid = null;
  inFlight = null;
}

/**
 * Pull the cloud copy of the supplier book into the local cache.
 *
 * This was a no-op for a long time, so a reinstall (or a second phone) showed
 * an EMPTY book even though Firestore still held every import and saved rate
 * — and the pricing pipeline, which only reads local, quietly went back to
 * retail. Never rejects; a failed or offline pull is retried by the next call.
 */
export function syncFavoritesFromCloud(): Promise<void> {
  let uid: string | undefined;
  try {
    uid = getAuth().currentUser?.uid;
  } catch {
    return Promise.resolve();
  }
  if (!uid || syncedForUid === uid) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = pullFavoritesFromCloud(uid).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function pullFavoritesFromCloud(uid: string): Promise<void> {
  try {
    const db = getFirestore();
    const snapshot = await getDocs(collection(db, `users/${uid}/materialFavorites`));
    const cloud: Record<string, FavoriteProductMapping> = {};
    for (const d of snapshot.docs) {
      // `savedAt` is a write stamp, not part of the mapping — drop it so the
      // local entry matches what saveFavoriteProduct would have written.
      const { savedAt: _savedAt, ...mapping } = d.data() as Partial<FavoriteProductMapping> & {
        savedAt?: string;
      };
      cloud[d.id] = mapping as FavoriteProductMapping;
    }

    const local = await loadFavoritesFromLocal();
    const { merged, added, updated } = mergeCloudFavorites(local, cloud);
    if (added > 0 || updated > 0) {
      await saveFavoritesToLocal(merged);
    }
    // Offline, getDocs RESOLVES from the (memory-only, so empty) cache rather
    // than rejecting. Latching on that would lock the session into an empty
    // book — only a server-backed read counts as synced.
    if (!snapshot.metadata?.fromCache) syncedForUid = uid;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[favorites] cloud sync failed', error);
  }
}
