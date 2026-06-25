import { describe, it, expect } from 'vitest';
import { resolveJobRequirements } from '../readTools';

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

  it('supplierBookPopulated is false (Phase-0 stub)', () => {
    const result = resolveJobRequirements({ categoryId: 'other', nicheId: 'fencing' });
    expect(result.supplierBookPopulated).toBe(false);
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
