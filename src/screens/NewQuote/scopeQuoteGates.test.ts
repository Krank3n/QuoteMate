/**
 * Regressions from driving the real app: a painter entering the three-line
 * scope quote hit two false warnings and a PDF that fell back to the
 * four-column materials table.
 */
import { describe, it, expect } from 'vitest';
import {
  isBlankDraft,
  pruneBlankMaterials,
  hasUnpricedMaterials,
  labourIsInScopeLines,
} from './scopeQuoteGates';
import type { Material } from '../../types';

const work = (name: string, price: number): Material => ({
  id: `w-${name}`, name, kind: 'work', scope: 'Scope of works.',
  quantity: 1, unit: 'each', price, totalPrice: price,
  manualPriceOverride: true, pricingSource: 'manual',
} as Material);

const material = (name: string, price: number): Material => ({
  id: `m-${name}`, name, quantity: 1, unit: 'each', price, totalPrice: price,
  manualPriceOverride: false, pricingSource: 'scraper',
} as Material);

const blank = (): Material => ({
  id: 'blank', name: '', quantity: 1, unit: 'each', price: 0, totalPrice: 0,
  manualPriceOverride: true, pricingSource: 'manual',
} as Material);

describe('isBlankDraft', () => {
  it('treats an unnamed or whitespace-only row as a blank draft', () => {
    expect(isBlankDraft({ name: '' })).toBe(true);
    expect(isBlankDraft({ name: '   ' })).toBe(true);
    expect(isBlankDraft({ name: 'Merbau decking' })).toBe(false);
  });
});

describe('pruneBlankMaterials', () => {
  it('drops the blank row the rapid-entry chain leaves behind', () => {
    const kept = pruneBlankMaterials([
      work('General Preparation to be carried out', 0),
      work('INTERIOR Surfaces to be painted', 22750),
      blank(),
    ]);
    expect(kept.map((m) => m.name)).toEqual([
      'General Preparation to be carried out',
      'INTERIOR Surfaces to be painted',
    ]);
  });

  it('keeps a real material priced at $0', () => {
    expect(pruneBlankMaterials([material('Offcuts on hand', 0)])).toHaveLength(1);
  });

  it('handles an absent materials array', () => {
    expect(pruneBlankMaterials(undefined)).toEqual([]);
  });
});

describe('hasUnpricedMaterials', () => {
  it('does not warn about a $0 work item — the inclusions line is deliberate', () => {
    expect(hasUnpricedMaterials([
      work('General Preparation to be carried out', 0),
      work('INTERIOR Surfaces to be painted', 22750),
    ])).toBe(false);
  });

  it('does not warn about a blank draft row', () => {
    expect(hasUnpricedMaterials([work('Interior', 22750), blank()])).toBe(false);
  });

  it('still warns about a real material with no price', () => {
    expect(hasUnpricedMaterials([work('Interior', 22750), material('Dulux Wash&Wear', 0)])).toBe(true);
  });
});

describe('labourIsInScopeLines', () => {
  it('is true when a priced scope line carries the labour', () => {
    expect(labourIsInScopeLines([work('INTERIOR Surfaces to be painted', 22750)])).toBe(true);
  });

  it('is false when the only work item is the $0 inclusions line', () => {
    expect(labourIsInScopeLines([work('General Preparation', 0)])).toBe(false);
  });

  it('is false for an ordinary materials quote', () => {
    expect(labourIsInScopeLines([material('Merbau decking', 690)])).toBe(false);
  });
});
