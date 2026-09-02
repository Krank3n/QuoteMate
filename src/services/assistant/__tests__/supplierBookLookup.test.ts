/**
 * search_supplier_book — what Mate sees when it looks in the tradie's book.
 *
 * The result has to be honest in three directions: an empty book must read as
 * "this phone can't see one", a starred retail product must not read as a
 * saved rate, and a hit must be what the pricing engine would actually use.
 */
import { describe, it, expect } from 'vitest';
import {
  SUPPLIER_BOOK_DEFAULT_LIMIT,
  SUPPLIER_BOOK_MAX_LIMIT,
  displaySupplier,
  resolveSupplierBookLookup,
} from '../supplierBookLookup';
import type { FavoriteProductMapping, SupplierGroup } from '../../../types';

function rate(productName: string, extra: Partial<FavoriteProductMapping> = {}): FavoriteProductMapping {
  return { productName, store: 'Metro Fencing', price: 40, unit: 'each', isPersonalRate: true, ...extra };
}

function group(name: string, sortOrder = 0): SupplierGroup {
  return { id: name.toLowerCase(), name, sortOrder, createdAt: '', updatedAt: '' } as SupplierGroup;
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
  // A starred Bunnings product is NOT a saved rate.
  { productName: 'Starred retail sleeper', store: 'Bunnings', price: 25, unit: 'each' },
];

describe('resolveSupplierBookLookup', () => {
  it('an empty book reads as "this phone can\'t see one", never "you haven\'t got one"', () => {
    const result = resolveSupplierBookLookup({ favorites: [], query: 'batts' });
    expect(result.populated).toBe(false);
    expect(result.total).toBe(0);
    expect(result.matches).toEqual([]);
    expect(result.note).toContain("This phone can't see a supplier book");
    expect(result.note).toContain("never that they haven't got one");
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
    expect(result.note).toContain('6 saved rates across 2 suppliers');
  });

  it('finds an entry by the word the tradie used, with price, unit, supplier and coverage', () => {
    const result = resolveSupplierBookLookup({ favorites: BOOK, query: 'insulation batts' });
    // Both batts entries come back; the order between them is the pricing
    // engine's own scorer, which this tool mirrors rather than second-guesses.
    expect(result.matches.map((m) => m.name).sort()).toEqual([
      'R2.5 HD Insulation Batts 580mm',
      'R4.0 Ceiling Batts 430mm',
    ]);
    expect(result.matches.find((m) => m.name.startsWith('R2.5'))).toMatchObject({
      name: 'R2.5 HD Insulation Batts 580mm',
      price: 48,
      unit: 'pack',
      supplier: 'Your prices',
      coverage: '8.7 m² per pack',
    });
    expect(result.note).toContain('the pricing engine prefers these over retail');
  });

  it('a spec-only query lists every matching SKU instead of nothing', () => {
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
    expect(result.matches[0].source).toBe('imported');
  });

  it('never offers an unpriced entry as a rate', () => {
    const result = resolveSupplierBookLookup({ favorites: BOOK, query: 'hinges' });
    expect(result.matches).toEqual([]);
    expect(result.note).toContain('No saved rate for "hinges"');
    expect(result.note).toContain('propose_update_line_item');
  });

  it('never surfaces a starred retail product as a saved rate', () => {
    const result = resolveSupplierBookLookup({ favorites: BOOK, query: 'sleeper' });
    expect(result.matches).toEqual([]);
  });

  it('ranks the preferred supplier first when the tradie has set a priority', () => {
    const favorites = [
      rate('Treated pine sleeper 200x75', { store: 'Bowens', price: 30 }),
      rate('Treated pine sleeper 200x75 H4', { store: 'Metro Fencing', price: 28 }),
    ];
    const groups = [group('Bowens', 0), group('Metro Fencing', 1)];
    const metroFirst = resolveSupplierBookLookup({
      favorites,
      groups,
      priorityOrder: ['metro fencing', 'bowens'],
      query: 'treated pine sleeper',
    });
    expect(metroFirst.matches[0].supplier).toBe('Metro Fencing');
  });

  it('caps and floors the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => rate(`Item ${i}`, { price: i + 1 }));
    expect(resolveSupplierBookLookup({ favorites: many }).matches).toHaveLength(SUPPLIER_BOOK_DEFAULT_LIMIT);
    expect(resolveSupplierBookLookup({ favorites: many, limit: 999 }).matches).toHaveLength(SUPPLIER_BOOK_MAX_LIMIT);
    expect(resolveSupplierBookLookup({ favorites: many, limit: 0 }).matches).toHaveLength(SUPPLIER_BOOK_DEFAULT_LIMIT);
    expect(resolveSupplierBookLookup({ favorites: many, limit: 1 }).matches).toHaveLength(1);
  });
});

describe('displaySupplier', () => {
  it("reads the storage placeholder as the tradie's own prices", () => {
    expect(displaySupplier('manual')).toBe('Your prices');
    expect(displaySupplier('')).toBe('Your prices');
    expect(displaySupplier(undefined)).toBe('Your prices');
    expect(displaySupplier('Bowens')).toBe('Bowens');
  });
});
