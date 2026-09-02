/**
 * search_supplier_book — the pure half of Mate's read over the tradie's own
 * rates. Until this existed Mate could see THAT a book existed (three
 * booleans on get_job_requirements) but never what was in it, which is why
 * tradies kept asking "why didn't you use my supplier book?" and Mate had
 * nothing to answer with.
 *
 * Matching reuses the same searchFavorites the pricing pipeline runs, so what
 * Mate reports IS what the engine will use — no second matcher to drift. A
 * plain substring pass backs it up: the scorer deliberately rejects a
 * spec-only query like "R2.5" (it would match every R2.5 SKU at pricing
 * time), but "what R2.5 have I got?" is a fair question to ask the book.
 */
import type { FavoriteProductMapping, SupplierGroup } from '../../types';
import { searchFavorites } from '../localMaterialMatcher';

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function containsLoose(query: string, text: string): boolean {
  const q = fold(query);
  return q.length >= 2 && fold(text).includes(q);
}

export const SUPPLIER_BOOK_DEFAULT_LIMIT = 10;
export const SUPPLIER_BOOK_MAX_LIMIT = 25;

export interface SupplierBookItem {
  name: string;
  price: number;
  unit?: string;
  supplier: string;
  /** "13 m² per sheet" — only when the entry carries coverage. */
  coverage?: string;
  keywords?: string[];
  source?: FavoriteProductMapping['source'];
  lastUpdatedAt?: string;
}

export interface SupplierBookLookupResult {
  populated: boolean;
  total: number;
  suppliers: string[];
  query?: string;
  matches: SupplierBookItem[];
  /** Model-facing guidance on how to read the result. */
  note: string;
}

export interface SupplierBookLookupInput {
  query?: string;
  limit?: number;
  favorites: FavoriteProductMapping[];
  groups?: SupplierGroup[];
  /** `BusinessSettings.supplierPriority` — ranks hits from preferred suppliers first. */
  priorityOrder?: string[];
}

/** Same rule as supplierBookCoverage: the tradie's OWN rates, not starred retail products. */
function isBookEntry(fav: FavoriteProductMapping): boolean {
  return fav.isPersonalRate === true || fav.source === 'imported' || fav.source === 'subscribed';
}

function hasPrice(fav: FavoriteProductMapping): fav is FavoriteProductMapping & { price: number } {
  return typeof fav.price === 'number' && fav.price > 0;
}

/** Entries saved without a supplier are stored as 'manual'; the tradie reads them as their own. */
export function displaySupplier(store: string | undefined): string {
  const s = store?.trim();
  return !s || s.toLowerCase() === 'manual' ? 'Your prices' : s;
}

function toItem(fav: FavoriteProductMapping & { price: number }): SupplierBookItem {
  return {
    name: fav.productName,
    price: fav.price,
    unit: fav.unit,
    supplier: displaySupplier(fav.store),
    ...(fav.coveragePerUnit && fav.coverageUnit
      ? { coverage: `${fav.coveragePerUnit} ${fav.coverageUnit} per ${fav.unit || 'unit'}` }
      : {}),
    ...(fav.keywords?.length ? { keywords: fav.keywords } : {}),
    ...(fav.source ? { source: fav.source } : {}),
    ...(fav.lastUpdatedAt ? { lastUpdatedAt: fav.lastUpdatedAt } : {}),
  };
}

const nameKey = (name: string) => name.toLowerCase().trim();
const updatedAtMs = (fav: FavoriteProductMapping) => Date.parse(fav.lastUpdatedAt ?? '') || 0;

export function resolveSupplierBookLookup(input: SupplierBookLookupInput): SupplierBookLookupResult {
  const requested = Math.floor(Number(input.limit));
  const limit = Math.min(
    Math.max(Number.isFinite(requested) && requested > 0 ? requested : SUPPLIER_BOOK_DEFAULT_LIMIT, 1),
    SUPPLIER_BOOK_MAX_LIMIT,
  );
  const entries = input.favorites.filter(isBookEntry);
  const priced = entries.filter(hasPrice);
  const suppliers = Array.from(new Set(entries.map((f) => displaySupplier(f.store))));
  const query = input.query?.trim() || undefined;

  if (entries.length === 0) {
    return {
      populated: false,
      total: 0,
      suppliers: [],
      query,
      matches: [],
      note:
        "This phone can't see a supplier book. Say it that way — never that they haven't got one — and offer propose_import_supplier_list if a price list would help.",
    };
  }

  if (!query) {
    const recent = [...priced]
      .sort((a, b) => updatedAtMs(b) - updatedAtMs(a))
      .slice(0, limit)
      .map(toItem);
    return {
      populated: true,
      total: entries.length,
      suppliers,
      matches: recent,
      note: `${entries.length} saved rate${entries.length === 1 ? '' : 's'} across ${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'}. Showing the ${recent.length} most recent — pass query to look one up.`,
    };
  }

  const byName = new Map(priced.map((f) => [nameKey(f.productName), f]));
  const seen = new Set<string>();
  const matches: SupplierBookItem[] = [];

  // Pass 1: exactly what the pricing engine would find for this term, in the
  // order it would take them — searchFavorites leaves sorting to its caller.
  const ranked = searchFavorites(query, input.favorites, input.groups ?? [], input.priorityOrder).sort(
    (a, b) => a._sortHint - b._sortHint,
  );
  for (const hit of ranked) {
    const key = nameKey(hit.productName);
    if (seen.has(key)) continue;
    seen.add(key);
    const fav = byName.get(key);
    matches.push(
      fav ? toItem(fav) : { name: hit.productName, price: hit.price, unit: hit.unit, supplier: displaySupplier(hit.store) },
    );
    if (matches.length >= limit) break;
  }

  // Pass 2: substring over name/keywords/notes, so a spec-only or one-word
  // question ("R2.5", "batts") still lists what the book holds.
  if (matches.length < limit) {
    for (const fav of priced) {
      const key = nameKey(fav.productName);
      if (seen.has(key)) continue;
      const haystack = [fav.productName, ...(fav.keywords ?? []), ...(fav.notes ? [fav.notes] : [])];
      if (!haystack.some((h) => containsLoose(query, h))) continue;
      seen.add(key);
      matches.push(toItem(fav));
      if (matches.length >= limit) break;
    }
  }

  const note =
    matches.length > 0
      ? `${matches.length} saved rate${matches.length === 1 ? '' : 's'} for "${query}" — the tradie's own prices; the pricing engine prefers these over retail.`
      : `No saved rate for "${query}" in a book of ${entries.length}. If the tradie has a number, put it on the line with propose_update_line_item — it's remembered here for next time.`;

  return { populated: true, total: entries.length, suppliers, query, matches, note };
}
