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

const FAVORITES_STORAGE_KEY = 'material_favorites';

/**
 * Generate a unique key for a material (used for storage)
 */
function getMaterialKey(materialName: string, searchTerm?: string): string {
  const key = searchTerm || materialName;
  return key.toLowerCase().trim().replace(/\s+/g, '_');
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
      {
        ...favorite,
        savedAt: new Date().toISOString(),
      }
    );
  } catch (error) {
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
  }
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
  }
}
