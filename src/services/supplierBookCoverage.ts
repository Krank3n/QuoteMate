/**
 * Supplier-book coverage — PURE, no storage, no Firebase.
 *
 * Two questions Mate needs answered before it offers anything: does this
 * tradie have their own rates at all, and would those rates actually price
 * THIS trade? The second matters because a plumber's imported list tells you
 * nothing useful about a Colorbond fence, and offering an import to someone
 * who already imported one reads as not paying attention.
 *
 * Coverage is scored with the same matcher the pricing pipeline's local pass
 * uses (scoreMatch / LOCAL_MATCH_THRESHOLD), so "covered" here means the same
 * thing it will mean when the pipeline runs.
 */

import { LOCAL_MATCH_THRESHOLD, scoreMatch } from './localMaterialMatcher';
import type { FavoriteProductMapping, SupplierGroup } from '../types';

/** Names shown back to the tradie — more than a few reads as a list, not a nod. */
const MAX_SUPPLIER_NAMES = 3;

export interface SupplierBookSnapshot {
  /** Favourites that are genuinely the tradie's own rates, not starred retail. */
  personalRateCount: number;
  /** Distinct supplier names, ≤3. */
  supplierNames: string[];
  /** Searchable text per personal-rate row — product name, keywords, notes. */
  entries: string[][];
}

export const EMPTY_SUPPLIER_BOOK: SupplierBookSnapshot = {
  personalRateCount: 0,
  supplierNames: [],
  entries: [],
};

/**
 * A row only counts when it is unmistakably the tradie's own rate. Deliberately
 * stricter than getExistingPersonalRateSuppliers, whose own comment says it
 * doesn't require isPersonalRate — under that rule one starred Bunnings
 * product would read as "book populated" and Mate would stop offering the
 * import to someone who has never done one.
 */
export function isSupplierBookEntry(fav: FavoriteProductMapping): boolean {
  return fav.isPersonalRate === true || fav.source === 'imported' || fav.source === 'subscribed';
}

export function buildSupplierBookSnapshot(
  favorites: FavoriteProductMapping[],
  groups: SupplierGroup[] = [],
): SupplierBookSnapshot {
  const entries: string[][] = [];
  const names: string[] = [];
  const seenNames = new Set<string>();

  const addName = (raw: string | undefined) => {
    const name = raw?.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seenNames.has(key)) return;
    seenNames.add(key);
    names.push(name);
  };

  for (const fav of favorites) {
    if (!isSupplierBookEntry(fav)) continue;
    entries.push(
      [fav.productName, ...(fav.keywords ?? []), ...(fav.notes ? [fav.notes] : [])].filter(Boolean),
    );
    addName(fav.store);
  }
  // Groups contribute names only — one can exist with zero items (a
  // contact-only supplier), which is not a populated book.
  for (const group of groups) addName(group.name);

  return {
    personalRateCount: entries.length,
    supplierNames: names.slice(0, MAX_SUPPLIER_NAMES),
    entries,
  };
}

/**
 * Which of the niche's core materials the book could price. Two hits is the
 * bar for "covers this trade" — one is a coincidence (every book has screws).
 */
export function coversProbes(
  snapshot: SupplierBookSnapshot,
  probes: string[],
): { hits: string[]; coversTrade: boolean } {
  const hits: string[] = [];
  for (const probe of probes) {
    if (!probe?.trim()) continue;
    const hit = snapshot.entries.some((haystacks) =>
      haystacks.some((text) => scoreMatch(probe, text) >= LOCAL_MATCH_THRESHOLD),
    );
    if (hit) hits.push(probe);
  }
  return { hits, coversTrade: hits.length >= 2 };
}
