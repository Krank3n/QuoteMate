/**
 * Loading the supplier-book snapshot Mate reasons over.
 *
 * Reads the LOCAL favourites cache on purpose: it's the same source
 * searchLocalSources uses at pricing time, so the flag truthfully predicts
 * what the pipeline will do, and it works with no signal on site.
 *
 * The cloud copy is pulled into that cache once per session before the first
 * read (syncFavoritesFromCloud), so a reinstall no longer reads empty. It can
 * still be empty offline or before the pull lands, so every line of copy built
 * on it must say "I can't see a supplier list on this phone" — never "you
 * haven't got one".
 */

import { loadFavoritesFromLocal, syncFavoritesFromCloud } from './materialFavorites';
import { loadGroups } from './supplierGroupService';
import {
  buildSupplierBookSnapshot,
  EMPTY_SUPPLIER_BOOK,
  type SupplierBookSnapshot,
} from './supplierBookCoverage';

// Mate can call get_job_requirements several times in one turn; the book only
// changes when an import finishes, which invalidates the cache explicitly.
const CACHE_TTL_MS = 60_000;

let cache: { at: number; snapshot: SupplierBookSnapshot } | null = null;

export async function loadSupplierBookSnapshot(): Promise<SupplierBookSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;
  try {
    await syncFavoritesFromCloud();
    const [favorites, groups] = await Promise.all([
      loadFavoritesFromLocal(),
      loadGroups().catch(() => []),
    ]);
    const snapshot = buildSupplierBookSnapshot(Object.values(favorites), groups);
    cache = { at: Date.now(), snapshot };
    return snapshot;
  } catch {
    // An unreadable cache is not "no supplier book" — don't poison the memo
    // with a false empty that outlives the failure.
    return EMPTY_SUPPLIER_BOOK;
  }
}

/** Call after anything writes to the book, or Mate re-offers the import it just did. */
export function invalidateSupplierBookCache(): void {
  cache = null;
}
