/**
 * Local Material Search
 *
 * Searches the user's own data — saved section templates and supplier-tagged
 * favorites — BEFORE hitting any remote source (Bunnings scraper, web scraping,
 * AI estimation). The user's own prices are always more relevant than retail.
 *
 * Result rows are shaped to plug straight into AddMaterialScreen's existing
 * `searchResults` list, with two extra fields (`isLocalSource`, `localSource`,
 * `localSourceLabel`) so the UI can render a provenance badge and so
 * `handleSelectProduct` can route them to the right Material constructor.
 */

import { loadTemplatesFromLocal } from './sectionTemplateService';
import { loadFavoritesFromLocal } from './materialFavorites';
import { FavoriteProductMapping, SectionTemplate, SupplierGroup } from '../types';

export type LocalSourceKind = 'template' | 'favorite';

export interface LocalSearchResult {
  productName: string;
  description: string;
  itemNumber: string;
  brand: string;
  price: number;
  productUrl?: string;
  imageUrl?: string;
  store: string;
  unit?: string;
  // Provenance — consumed by AddMaterialScreen badge rendering and
  // handleSelectProduct's Material construction.
  isLocalSource: true;
  isScraperResult: false;
  isAiEstimate: false;
  localSource: LocalSourceKind;
  localSourceLabel: string;   // "From template: Standard Bay" / "From Joe's Fencing"
  // Sort hint — lower wins. Templates use 0; favorites inherit their supplier's
  // sortOrder so the user's preferred supplier rises to the top.
  _sortHint: number;
}

/** Lowercase + collapse whitespace for fuzzy comparison. */
function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** True if `query` substring-matches `text` in either direction (handles plurals loosely). */
function looseMatch(query: string, text: string): boolean {
  const q = norm(query);
  const t = norm(text);
  if (!q || !t) return false;
  if (t.includes(q) || q.includes(t)) return true;
  // Try plural/singular swap on the query
  if (q.endsWith('s') && t.includes(q.slice(0, -1))) return true;
  if (!q.endsWith('s') && t.includes(q + 's')) return true;
  // Token-level: every query word appears somewhere in text
  const qWords = q.split(' ').filter(w => w.length > 1);
  if (qWords.length > 1 && qWords.every(w => t.includes(w))) return true;
  return false;
}

/**
 * Match the user's `store` favorite tag against their configured supplier
 * groups. Bunnings imports tag favorites with `'bunnings.com.au'`, so we
 * accept either an exact-name match or a substring on the supplier name.
 */
function favoriteBelongsToSupplier(
  fav: FavoriteProductMapping,
  supplierNamesLower: Set<string>
): boolean {
  const store = fav.store?.trim().toLowerCase();
  if (!store) return false;
  if (supplierNamesLower.has(store)) return true;
  // Loose contains: "bunnings.com.au" matches a "Bunnings" supplier
  for (const name of supplierNamesLower) {
    if (store.includes(name) || name.includes(store)) return true;
  }
  return false;
}

function searchTemplates(
  query: string,
  templates: SectionTemplate[]
): LocalSearchResult[] {
  const results: LocalSearchResult[] = [];
  for (const tpl of templates) {
    const templateMatches =
      looseMatch(query, tpl.name) ||
      (tpl.keywords?.some(kw => looseMatch(query, kw)) ?? false);

    for (const mat of tpl.materials) {
      const matMatches = looseMatch(query, mat.name);
      // Surface a material if either:
      //  - the template itself matched the query (e.g. "fence bay" → all bay parts), OR
      //  - the individual material name matched (e.g. "post" → just the posts)
      if (!templateMatches && !matMatches) continue;
      if (typeof mat.price !== 'number' || mat.price <= 0) continue;

      results.push({
        productName: mat.name,
        description: `From template: ${tpl.name}`,
        itemNumber: '',
        brand: '',
        price: mat.price,
        productUrl: undefined,
        imageUrl: undefined,
        store: tpl.name,
        unit: mat.unit,
        isLocalSource: true,
        isScraperResult: false,
        isAiEstimate: false,
        localSource: 'template',
        localSourceLabel: `From template: ${tpl.name}`,
        _sortHint: 0,
      });
    }
  }
  return results;
}

function searchFavorites(
  query: string,
  favorites: FavoriteProductMapping[],
  suppliers: SupplierGroup[]
): LocalSearchResult[] {
  if (suppliers.length === 0) return [];
  const supplierNamesLower = new Set(suppliers.map(s => s.name.trim().toLowerCase()));
  const sortOrderByName = new Map(
    suppliers.map(s => [s.name.trim().toLowerCase(), s.sortOrder ?? 999])
  );

  const results: LocalSearchResult[] = [];
  for (const fav of favorites) {
    if (!favoriteBelongsToSupplier(fav, supplierNamesLower)) continue;
    const haystack = [
      fav.productName,
      ...(fav.keywords ?? []),
      fav.notes ?? '',
    ].join(' ');
    if (!looseMatch(query, haystack)) continue;
    if (typeof fav.price !== 'number' || fav.price <= 0) continue;

    // Resolve sort hint from the matched supplier (favor exact, then loose)
    const storeLower = fav.store?.trim().toLowerCase() ?? '';
    let sortHint = sortOrderByName.get(storeLower);
    if (sortHint === undefined) {
      for (const [name, order] of sortOrderByName.entries()) {
        if (storeLower.includes(name) || name.includes(storeLower)) {
          sortHint = order;
          break;
        }
      }
    }
    // Templates rank at 0; favorites start at 1 + supplier sortOrder so a
    // matched template (almost always a closer fit) wins ties.
    const rankedHint = 1 + (sortHint ?? 999);

    results.push({
      productName: fav.productName,
      description: `From ${fav.store}`,
      itemNumber: fav.itemNumber ?? '',
      brand: '',
      price: fav.price,
      productUrl: fav.productUrl,
      imageUrl: fav.imageUrl,
      store: fav.store,
      unit: fav.unit,
      isLocalSource: true,
      isScraperResult: false,
      isAiEstimate: false,
      localSource: 'favorite',
      localSourceLabel: `From ${fav.store}`,
      _sortHint: rankedHint,
    });
  }
  return results;
}

/**
 * Search the user's local sources (templates + supplier-scoped favorites) for
 * materials matching `query`. Returns ranked results — templates first, then
 * favorites in supplier-`sortOrder` order.
 *
 * Designed to be called BEFORE any remote price source. Empty result is
 * normal — caller should fall through to scraper/web-search.
 */
export async function searchLocalSources(
  query: string,
  suppliers: SupplierGroup[]
): Promise<LocalSearchResult[]> {
  if (!query.trim()) return [];

  const [templates, favoritesMap] = await Promise.all([
    loadTemplatesFromLocal(),
    loadFavoritesFromLocal(),
  ]);
  const favorites = Object.values(favoritesMap);

  const templateHits = searchTemplates(query, templates);
  const favoriteHits = searchFavorites(query, favorites, suppliers);

  return [...templateHits, ...favoriteHits].sort((a, b) => a._sortHint - b._sortHint);
}
