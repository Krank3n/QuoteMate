/**
 * search_supplier_book — the pure half of Mate's read over the tradie's own
 * rates. Until this existed Mate could see THAT a book existed (three
 * booleans on get_job_requirements) but never what was in it, which is why
 * tradies kept asking "why didn't you use my supplier book?" and Mate had
 * nothing to answer with.
 *
 * Entries are the same set get_job_requirements counts as "populated"
 * (isSupplierBookEntry), so the two tools never disagree about whether a
 * book exists. Ranking uses the pipeline's own scoreMatch, with a plain
 * substring pass behind it: the scorer deliberately rejects a spec-only
 * query like "R2.5" (it would match every R2.5 SKU at pricing time), but
 * "what R2.5 have I got?" is a fair question to ask the book.
 */
import type { FavoriteProductMapping } from '../../types';
import { scoreMatch, LOCAL_MATCH_THRESHOLD } from '../localMaterialMatcher';
import { isSupplierBookEntry } from '../supplierBookCoverage';

export const SUPPLIER_BOOK_DEFAULT_LIMIT = 10;
export const SUPPLIER_BOOK_MAX_LIMIT = 25;

export interface SupplierBookItem {
  name: string;
  /** GST-inclusive, as the supplier quotes it. */
  price: number;
  unit?: string;
  supplier: string;
  /** "8.7 m² per pack" — only when the entry carries coverage. */
  coverage?: string;
}

export interface SupplierBookLookupResult {
  /** False means THIS PHONE can't see a book — never that the tradie hasn't got one. */
  populated: boolean;
  total: number;
  suppliers: string[];
  matches: SupplierBookItem[];
}

export interface SupplierBookLookupInput {
  query?: string;
  limit?: number;
  favorites: FavoriteProductMapping[];
}

type Priced = FavoriteProductMapping & { price: number };

function hasPrice(fav: FavoriteProductMapping): fav is Priced {
  return typeof fav.price === 'number' && fav.price > 0;
}

/** Entries saved without a supplier are stored as 'manual'; the tradie reads them as their own. */
function displaySupplier(store: string | undefined): string {
  const s = store?.trim();
  return !s || s.toLowerCase() === 'manual' ? 'Your prices' : s;
}

function toItem(fav: Priced): SupplierBookItem {
  return {
    name: fav.productName,
    price: fav.price,
    unit: fav.unit,
    supplier: displaySupplier(fav.store),
    ...(fav.coveragePerUnit && fav.coverageUnit
      ? { coverage: `${fav.coveragePerUnit} ${fav.coverageUnit} per ${fav.unit || 'unit'}` }
      : {}),
  };
}

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const updatedAtMs = (fav: FavoriteProductMapping) => Date.parse(fav.lastUpdatedAt ?? '') || 0;

function searchable(fav: FavoriteProductMapping): string[] {
  return [fav.productName, ...(fav.keywords ?? []), ...(fav.notes ? [fav.notes] : [])].filter(Boolean);
}

export function resolveSupplierBookLookup(input: SupplierBookLookupInput): SupplierBookLookupResult {
  const requested = Math.floor(Number(input.limit));
  const limit = Math.min(
    Math.max(Number.isFinite(requested) && requested > 0 ? requested : SUPPLIER_BOOK_DEFAULT_LIMIT, 1),
    SUPPLIER_BOOK_MAX_LIMIT,
  );
  const entries = input.favorites.filter(isSupplierBookEntry);
  if (entries.length === 0) return { populated: false, total: 0, suppliers: [], matches: [] };

  const priced = entries.filter(hasPrice);
  const suppliers = Array.from(new Set(entries.map((f) => displaySupplier(f.store))));
  const query = input.query?.trim();

  if (!query) {
    const recent = [...priced].sort((a, b) => updatedAtMs(b) - updatedAtMs(a));
    return { populated: true, total: entries.length, suppliers, matches: recent.slice(0, limit).map(toItem) };
  }

  // Scored hits first (best score wins), then anything the scorer refused
  // but that plainly contains the words asked for.
  const scored = priced
    .map((fav) => ({ fav, score: Math.max(0, ...searchable(fav).map((text) => scoreMatch(query, text))) }))
    .filter((x) => x.score >= LOCAL_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.fav);
  const q = fold(query);
  const substring =
    q.length >= 2
      ? priced.filter((fav) => !scored.includes(fav) && searchable(fav).some((text) => fold(text).includes(q)))
      : [];

  return {
    populated: true,
    total: entries.length,
    suppliers,
    matches: [...scored, ...substring].slice(0, limit).map(toItem),
  };
}
