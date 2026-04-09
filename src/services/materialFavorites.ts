/**
 * Material Favorites Storage Service
 *
 * Manages user's favorite product mappings with local + cloud sync.
 * When a user selects a product for a material, it can be saved as a favorite
 * so future quotes automatically use that product.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { FavoriteProductMapping } from '../types';
import { logSyncError } from '../store/useStore';

const FAVORITES_STORAGE_KEY = 'material_favorites';

/**
 * Generate a unique key for a material (used for storage)
 */
function getMaterialKey(materialName: string, searchTerm?: string): string {
  const key = searchTerm || materialName;
  return key.toLowerCase().trim().replace(/\s+/g, '_');
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
      const nextCoveragePerUnit = incoming.coveragePerUnit ?? existing.coveragePerUnit;
      const nextCoverageUnit = incoming.coverageUnit ?? existing.coverageUnit;

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

    // Push to Firestore (best-effort, don't block the batch).
    if (db && uid && status !== 'unchanged') {
      try {
        await setDoc(
          doc(db, `users/${uid}/materialFavorites/${key}`),
          stripUndefined({
            ...merged,
            savedAt: new Date().toISOString(),
          }),
          { merge: true }
        );
      } catch (error) {
        // Local cache is source of truth for this session, but surface the
        // failure so the user knows their bulk import didn't fully sync.
        // logSyncError keeps only the most recent error, so a noisy import
        // won't spam the banner — the user just sees that *something* failed.
        logSyncError('favorite', key, error);
      }
    }
  }

  await saveFavoritesToLocal(localFavorites);

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
 * Sync favorites from cloud to local (run on app startup)
 */
export async function syncFavoritesFromCloud(): Promise<void> {
  try {
    const auth = getAuth();
    if (!auth.currentUser) return;

    const db = getFirestore();
    // Note: This would require a collection query, which we'll implement if needed
    // For now, favorites are synced lazily when accessed
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[favorites] startup sync failed', error);
  }
}
