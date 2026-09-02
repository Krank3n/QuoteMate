/**
 * search_supplier_book — what Mate sees when it looks in the tradie's book.
 *
 * The result has to be honest in three directions: an empty book must read as
 * "this phone can't see one" (populated: false), a starred retail product
 * must never read as a saved rate, and the entries counted here must be the
 * same set get_job_requirements counts as "populated".
 */
import { describe, it, expect } from 'vitest';
import {
  SUPPLIER_BOOK_DEFAULT_LIMIT,
  SUPPLIER_BOOK_MAX_LIMIT,
  resolveSupplierBookLookup,
} from '../supplierBookLookup';
import type { FavoriteProductMapping } from '../../../types';

function rate(productName: string, extra: Partial<FavoriteProductMapping> = {}): FavoriteProductMapping {
  return { productName, store: 'Metro Fencing', price: 40, unit: 'each', isPersonalRate: true, ...extra };
}

const BOOK: FavoriteProductMapping[] = [
  rate('Colorbond fence infill sheet 1.8m Monument', { price: 62, lastUpdatedAt: '2026-08-01T00:00:00.000Z' }),
  rate('Fence post 75x75x2.4', { price: 32, lastUpdatedAt: '2026-08-03T00:00:00.000Z', keywords: ['post', 'colorbond post'] }),
  rate('R2.5 HD Insulation Batts 580mm', {
    store: 'manual',
    price: 48,
    unit: 'pack',
    coveragePerUnit: 8.7,
    coverageUnit: 'm²',
    source: 'manual',
    lastUpdatedAt: '2026-08-05T00:00:00.000Z',
  }),
  rate('R4.0 Ceiling Batts 430mm', { store: 'manual', price: 71, unit: 'pack', lastUpdatedAt: '2026-08-04T00:00:00.000Z' }),
  // Imported but never flagged — still the tradie's own supplier.
  rate('Gate kit 1.2m', { isPersonalRate: undefined, source: 'imported', price: 180 }),
  // Imported with no price yet: counted, never offered as a rate.
  rate('Gate hinges heavy duty', { price: undefined, source: 'imported' }),
  // A starred Bunnings product is NOT a saved rate, even under a supplier name.
  { productName: 'Starred retail sleeper', store: 'Bunnings', price: 25, unit: 'each' },
];

describe('resolveSupplierBookLookup', () => {
  it('an empty book reads as "this phone can\'t see one"', () => {
    expect(resolveSupplierBookLookup({ favorites: [], query: 'batts' })).toEqual({
      populated: false,
      total: 0,
      suppliers: [],
      matches: [],
    });
  });

  it('a book of only starred retail products is not a book', () => {
    const result = resolveSupplierBookLookup({
      favorites: [{ productName: 'Starred retail sleeper', store: 'Bunnings', price: 25 }],
    });
    expect(result.populated).toBe(false);
  });

  it('with no query, summarises the book: count, suppliers, most recent first', () => {
    const result = resolveSupplierBookLookup({ favorites: BOOK, limit: 3 });
    expect(result.populated).toBe(true);
    // Six of the seven count (the starred product doesn't); the unpriced import still counts.
    expect(result.total).toBe(6);
    expect(result.suppliers).toEqual(['Metro Fencing', 'Your prices']);
    expect(result.matches.map((m) => m.name)).toEqual([
      'R2.5 HD Insulation Batts 580mm',
      'R4.0 Ceiling Batts 430mm',
      'Fence post 75x75x2.4',
    ]);
  });

  it('finds entries by the words the tradie used, with price, unit, supplier and coverage', () => {
    const result = resolveSupplierBookLookup({ favorites: BOOK, query: 'insulation batts' });
    expect(result.matches.map((m) => m.name).sort()).toEqual([
      'R2.5 HD Insulation Batts 580mm',
      'R4.0 Ceiling Batts 430mm',
    ]);
    expect(result.matches.find((m) => m.name.startsWith('R2.5'))).toEqual({
      name: 'R2.5 HD Insulation Batts 580mm',
      price: 48,
      unit: 'pack',
      supplier: 'Your prices',
      coverage: '8.7 m² per pack',
    });
  });

  it('a spec-only query lists the matching SKU instead of nothing', () => {
    // The pricing-time scorer rejects "R2.5" on purpose; the book lookup
    // should still answer "what R2.5 have I got?".
    const result = resolveSupplierBookLookup({ favorites: BOOK, query: 'R2.5' });
    expect(result.matches.map((m) => m.name)).toEqual(['R2.5 HD Insulation Batts 580mm']);
  });

  it('matches on keywords, not just names', () => {
    const result = resolveSupplierBookLookup({ favorites: BOOK, query: 'colorbond post' });
    expect(result.matches.map((m) => m.name)).toContain('Fence post 75x75x2.4');
  });

  it('reaches an imported entry that was never flagged personal', () => {
    const result = resolveSupplierBookLookup({ favorites: BOOK, query: 'gate kit' });
    expect(result.matches.map((m) => m.name)).toEqual(['Gate kit 1.2m']);
    expect(result.matches[0].supplier).toBe('Metro Fencing');
  });

  it('never offers an unpriced entry as a rate', () => {
    const result = resolveSupplierBookLookup({ favorites: BOOK, query: 'hinges' });
    expect(result.matches).toEqual([]);
    expect(result.populated).toBe(true);
  });

  it('never surfaces a starred retail product as a saved rate', () => {
    expect(resolveSupplierBookLookup({ favorites: BOOK, query: 'sleeper' }).matches).toEqual([]);
    expect(resolveSupplierBookLookup({ favorites: BOOK, query: 'starred' }).matches).toEqual([]);
  });

  it('caps and floors the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => rate(`Item ${i}`, { price: i + 1 }));
    expect(resolveSupplierBookLookup({ favorites: many }).matches).toHaveLength(SUPPLIER_BOOK_DEFAULT_LIMIT);
    expect(resolveSupplierBookLookup({ favorites: many, limit: 999 }).matches).toHaveLength(SUPPLIER_BOOK_MAX_LIMIT);
    expect(resolveSupplierBookLookup({ favorites: many, limit: 0 }).matches).toHaveLength(SUPPLIER_BOOK_DEFAULT_LIMIT);
    expect(resolveSupplierBookLookup({ favorites: many, limit: 1 }).matches).toHaveLength(1);
  });
});
