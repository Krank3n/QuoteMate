/**
 * Local Material Search — loader orchestration.
 *
 * The pure matcher (scoring, ranking, classification) lives in
 * `localMaterialMatcher.ts` and is unit-tested in isolation. This file is
 * the only side-effect-y piece: it reads the user's saved templates and
 * supplier favourites from local storage, then delegates ranking to the
 * matcher.
 *
 * Designed to be called BEFORE any remote price source. Empty result is
 * normal — caller should fall through to scraper/web-search.
 */

import { loadTemplatesFromLocal } from './sectionTemplateService';
import { loadFavoritesFromLocal } from './materialFavorites';
import type { SupplierGroup } from '../types';
import { rankLocalHits, type LocalSearchResult } from './localMaterialMatcher';

// Re-export the matcher's surface so existing callers don't need to update
// their imports.
export {
  scoreMatch,
  looseMatch,
  classifyTokens,
  searchTemplates,
  searchFavorites,
  LOCAL_MATCH_THRESHOLD,
} from './localMaterialMatcher';
export type { LocalSearchResult, LocalSourceKind, ClassifiedToken } from './localMaterialMatcher';

export interface LocalSearchOptions {
  /** Include section-template matches alongside favorites. Defaults to true. */
  includeTemplates?: boolean;
  /** `BusinessSettings.supplierPriority` — the drag-and-drop ranked list. */
  priorityOrder?: string[];
}

/**
 * Search the user's local sources (templates + supplier-scoped favorites) for
 * materials matching `query`. Returns hits ranked by:
 *   1. Templates above favourites by default (templates pack accurate
 *      per-section materials so they're a tighter fit).
 *   2. Within favourites, supplier priority order wins.
 *   3. Match score breaks ties within the same supplier.
 */
export async function searchLocalSources(
  query: string,
  suppliers: SupplierGroup[],
  options: LocalSearchOptions = {}
): Promise<LocalSearchResult[]> {
  if (!query.trim()) return [];
  const { includeTemplates = true } = options;

  const [templates, favoritesMap] = await Promise.all([
    includeTemplates ? loadTemplatesFromLocal() : Promise.resolve([]),
    loadFavoritesFromLocal(),
  ]);
  return rankLocalHits(query, {
    templates,
    favorites: Object.values(favoritesMap),
    suppliers,
    priorityOrder: options.priorityOrder,
    includeTemplates,
  });
}
