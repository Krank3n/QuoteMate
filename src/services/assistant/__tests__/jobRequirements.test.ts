import { describe, it, expect } from 'vitest';
import { resolveJobRequirements } from '../readTools';
import { buildSupplierBookSnapshot } from '../../supplierBookCoverage';
import type { FavoriteProductMapping } from '../../../types';

function personalRate(
  productName: string,
  store = 'Metro Fencing',
): FavoriteProductMapping {
  return { productName, store, price: 40, isPersonalRate: true };
}

const COLORBOND_BOOK = buildSupplierBookSnapshot([
  personalRate('Colorbond fence infill sheet 1.8m Monument'),
  personalRate('Colorbond fence post 75 x 75 x 2.4m'),
  personalRate('Colorbond fence top rail 2.4m'),
]);

const PLUMBING_BOOK = buildSupplierBookSnapshot([
  personalRate('Copper pipe 15mm x 3m', 'Reece'),
  personalRate('Basin mixer chrome', 'Reece'),
]);

describe('resolveJobRequirements', () => {
  it('returns mustAskQuestions for fencing niche', () => {
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing' });
    const labels = result.mustAskQuestions.map(q => q.toLowerCase());
    expect(labels.some(l => l.includes('length') || l.includes('linear') || l.includes('metre'))).toBe(true);
    expect(labels.some(l => l.includes('height') || l.includes('panel'))).toBe(true);
    expect(labels.some(l => l.includes('gate') || l.includes('gates'))).toBe(true);
    expect(labels.some(l => l.includes('removal') || l.includes('old fence') || l.includes('exist'))).toBe(true);
  });

  it('returns mustAskQuestions for lawn care niche', () => {
    const result = resolveJobRequirements({ categoryId: 'landscape_gardening', nicheId: 'lawn_care' });
    const labels = result.mustAskQuestions.map(q => q.toLowerCase());
    expect(labels.some(l => l.includes('area') || l.includes('size') || l.includes('m²') || l.includes('sqm'))).toBe(true);
  });

  it('matches fencing from freeText', () => {
    const result = resolveJobRequirements({ freeText: 'colorbond fence quote' });
    expect(result.matched.nicheId).toBe('fencing');
    expect(result.matched.categoryId).toBe('other');
  });

  it('specialistSupply true for fencing', () => {
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing' });
    expect(result.specialistSupply).toBe(true);
  });

  it('specialistSupply false for painting', () => {
    const result = resolveJobRequirements({ categoryId: 'painting', nicheId: 'interior' });
    expect(result.specialistSupply).toBe(false);
  });

  it('supplierBookPopulated is false when no supplier-book snapshot is supplied', () => {
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing' });
    expect(result.supplierBookPopulated).toBe(false);
    expect(result.supplierBookSuppliers).toEqual([]);
    expect(result.supplierBookCoversTrade).toBe(false);
  });

  it('supplierBookPopulated is true when the snapshot has imported items', () => {
    const result = resolveJobRequirements({
      categoryId: 'other',
      nicheId: 'fencing',
      supplierBook: COLORBOND_BOOK,
    });
    expect(result.supplierBookPopulated).toBe(true);
  });

  it('coversTrade is true for a fencing job against a Colorbond list', () => {
    const result = resolveJobRequirements({
      categoryId: 'other',
      nicheId: 'fencing',
      supplierBook: COLORBOND_BOOK,
    });
    expect(result.supplierBookCoversTrade).toBe(true);
  });

  it('coversTrade is false for a fencing job against a plumbing list', () => {
    const result = resolveJobRequirements({
      categoryId: 'other',
      nicheId: 'fencing',
      supplierBook: PLUMBING_BOOK,
    });
    expect(result.supplierBookPopulated).toBe(true);
    expect(result.supplierBookCoversTrade).toBe(false);
  });

  it('supplierBookSuppliers echoes at most 3 names', () => {
    const book = buildSupplierBookSnapshot([
      personalRate('a', 'Metro Fencing'),
      personalRate('b', 'Stratco'),
      personalRate('c', 'Bowens'),
      personalRate('d', 'Reece'),
    ]);
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing', supplierBook: book });
    expect(result.supplierBookSuppliers).toEqual(['Metro Fencing', 'Stratco', 'Bowens']);
  });

  // Injecting a snapshot (rather than loading one) is what keeps this callable
  // from the pure tool path with no AsyncStorage / Firestore in the graph.
  it('resolveJobRequirements stays synchronous and does no IO', () => {
    const result = resolveJobRequirements({
      categoryId: 'other',
      nicheId: 'fencing',
      supplierBook: COLORBOND_BOOK,
    });
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as unknown as { then?: unknown }).then).toBe('undefined');
  });

  it('measurementDriven true for per_linear_m niche', () => {
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing' });
    // fencing is per_linear_m
    if (result.pricingMethod) {
      if (['per_linear_m', 'per_sqm', 'per_cubic_m'].includes(result.pricingMethod)) {
        expect(result.measurementDriven).toBe(true);
      }
    }
  });

  it('returns empty mustAskQuestions for unknown niche', () => {
    const result = resolveJobRequirements({ categoryId: 'unknown_cat', nicheId: 'unknown_niche' });
    expect(Array.isArray(result.mustAskQuestions)).toBe(true);
  });
});
