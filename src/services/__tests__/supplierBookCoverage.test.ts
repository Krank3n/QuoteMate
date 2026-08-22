// "Has this tradie got a supplier book, and would it price THIS job?"
//
// The strict predicate matters: getExistingPersonalRateSuppliers deliberately
// doesn't require isPersonalRate, so reusing it would let one starred Bunnings
// product read as a populated book — and Mate would stop offering the import
// to someone who has never done one.

import { describe, it, expect } from 'vitest';
import { buildSupplierBookSnapshot, coversProbes } from '../supplierBookCoverage';
import type { FavoriteProductMapping, SupplierGroup } from '../../types';

function fav(
  productName: string,
  extra: Partial<FavoriteProductMapping> = {},
): FavoriteProductMapping {
  return { productName, store: 'Metro Fencing', price: 40, ...extra };
}

function group(name: string): SupplierGroup {
  return { id: name, name, sortOrder: 0, createdAt: '', updatedAt: '' } as SupplierGroup;
}

// Straight off the fencing / plumbing niche templates' suggestedMaterials.
const FENCE_PROBES = ['Colorbond infill', 'Posts', 'Rails', 'Concrete', 'Caps', 'Gate kit'];

describe('buildSupplierBookSnapshot', () => {
  it('counts only personal-rate, imported and subscribed favourites', () => {
    const snapshot = buildSupplierBookSnapshot([
      fav('Colorbond sheet 1.8m Monument', { isPersonalRate: true }),
      fav('Fence post 75x75x2.4', { source: 'imported' }),
      fav('Rail 2.4m', { source: 'subscribed' }),
      fav('Ryobi drill', { source: 'manual' }),
    ]);
    expect(snapshot.personalRateCount).toBe(3);
  });

  it('a single starred Bunnings favourite is not a populated book', () => {
    const snapshot = buildSupplierBookSnapshot([
      fav('Ryobi 18V drill', { store: 'bunnings.com.au', source: 'manual' }),
    ]);
    expect(snapshot.personalRateCount).toBe(0);
    expect(snapshot.supplierNames).toEqual([]);
  });

  it('dedupes names case-insensitively and caps at 3', () => {
    const snapshot = buildSupplierBookSnapshot(
      [
        fav('a', { store: 'Metro Fencing', isPersonalRate: true }),
        fav('b', { store: 'metro fencing', isPersonalRate: true }),
        fav('c', { store: 'Stratco', isPersonalRate: true }),
      ],
      [group('METRO FENCING'), group('Reece'), group('Bowens')],
    );
    expect(snapshot.supplierNames).toEqual(['Metro Fencing', 'Stratco', 'Reece']);
  });

  it('takes names from groups that have no items yet', () => {
    const snapshot = buildSupplierBookSnapshot([], [group('Metro Fencing')]);
    expect(snapshot.supplierNames).toEqual(['Metro Fencing']);
    // A contact-only group is still not a populated book.
    expect(snapshot.personalRateCount).toBe(0);
  });
});

describe('coversProbes', () => {
  it('coversTrade is true when 2+ probes clear the threshold', () => {
    const snapshot = buildSupplierBookSnapshot([
      fav('Colorbond fence infill sheet 1.8m Monument', { isPersonalRate: true }),
      fav('Colorbond fence post 75 x 75 x 2.4m', { isPersonalRate: true }),
    ]);
    const { hits, coversTrade } = coversProbes(snapshot, FENCE_PROBES);
    expect(coversTrade).toBe(true);
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('is false for a fencing job against a plumbing-only book', () => {
    const snapshot = buildSupplierBookSnapshot([
      fav('Copper pipe 15mm x 3m', { isPersonalRate: true }),
      fav('Basin mixer chrome', { isPersonalRate: true }),
      fav('PVC DWV 100mm bend', { isPersonalRate: true }),
    ]);
    expect(coversProbes(snapshot, FENCE_PROBES).coversTrade).toBe(false);
  });

  it('empty favourites cover nothing', () => {
    const snapshot = buildSupplierBookSnapshot([]);
    expect(snapshot.personalRateCount).toBe(0);
    expect(coversProbes(snapshot, FENCE_PROBES).coversTrade).toBe(false);
  });

  it('matches through keywords as well as the product name', () => {
    const snapshot = buildSupplierBookSnapshot([
      fav('MON-1800-INF', { isPersonalRate: true, keywords: ['colorbond', 'infill'] }),
      fav('POST-75-24', { isPersonalRate: true, keywords: ['fence', 'posts'] }),
    ]);
    expect(coversProbes(snapshot, FENCE_PROBES).coversTrade).toBe(true);
  });
});
