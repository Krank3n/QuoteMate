import { describe, it, expect } from 'vitest';
import { summarizePriceFetchOutcome } from '../priceFetchTelemetry';
import type { Material } from '../../types';

function mat(overrides: Partial<Material>): Material {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'thing',
    quantity: 1,
    unit: 'each',
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
    ...overrides,
  };
}

describe('summarizePriceFetchOutcome — bySource + counts', () => {
  it('all-bunnings', () => {
    const mats = [
      mat({ price: 10, pricingSource: 'scraper' }),
      mat({ price: 20, pricingSource: 'scraper' }),
      mat({ price: 5, pricingSource: 'scraper' }),
    ];
    const s = summarizePriceFetchOutcome(mats, {
      fetchedCount: 3,
      failedCount: 0,
      skippedCount: 0,
      cancelled: false,
    });
    expect(s.bySource).toEqual({ bunnings: 3, reece: 0, websearch: 0, local: 0 });
    expect(s.fetched).toBe(3);
    expect(s.cancelled).toBe(false);
  });

  it('mixed-sources split', () => {
    const mats = [
      mat({ price: 10, pricingSource: 'scraper' }),
      mat({ price: 20, pricingSource: 'api' }),
      mat({ price: 5, pricingSource: 'ai' }),
      mat({ price: 8, pricingSource: 'manual' }),
    ];
    const s = summarizePriceFetchOutcome(mats, {
      fetchedCount: 4,
      failedCount: 0,
      skippedCount: 0,
      cancelled: false,
    });
    expect(s.bySource).toEqual({ bunnings: 1, reece: 1, websearch: 1, local: 1 });
  });

  it('all-failed', () => {
    const mats = [
      mat({ price: 0, pricingSource: undefined }),
      mat({ price: 0, pricingSource: undefined }),
    ];
    const s = summarizePriceFetchOutcome(mats, {
      fetchedCount: 0,
      failedCount: 2,
      skippedCount: 0,
      cancelled: false,
    });
    expect(s.bySource).toEqual({ bunnings: 0, reece: 0, websearch: 0, local: 0 });
    expect(s.failed).toBe(2);
  });

  it('cancelled-midrun partial', () => {
    const mats = [
      mat({ price: 10, pricingSource: 'scraper' }),
      mat({ price: 0, pricingSource: undefined }),
    ];
    const s = summarizePriceFetchOutcome(mats, {
      fetchedCount: 1,
      failedCount: 0,
      skippedCount: 1,
      cancelled: true,
    });
    expect(s.cancelled).toBe(true);
    expect(s.bySource.bunnings).toBe(1);
    expect(s.skipped).toBe(1);
  });

  it('skipped-preprice (manual saved-rate rows counted as local)', () => {
    const mats = [
      mat({ price: 12.5, pricingSource: 'manual' }),
      mat({ price: 12.5, pricingSource: 'manual' }),
    ];
    const s = summarizePriceFetchOutcome(mats, {
      fetchedCount: 0,
      failedCount: 0,
      skippedCount: 2,
      cancelled: false,
    });
    expect(s.bySource.local).toBe(2);
    expect(s.skipped).toBe(2);
  });

  it('unpriced rows not counted in bySource', () => {
    const mats = [
      // pricingSource is set but the row never resolved a price (price <= 0)
      mat({ price: 0, pricingSource: 'scraper' }),
      mat({ price: 15, pricingSource: 'scraper' }),
    ];
    const s = summarizePriceFetchOutcome(mats, {
      fetchedCount: 1,
      failedCount: 1,
      skippedCount: 0,
      cancelled: false,
    });
    expect(s.bySource.bunnings).toBe(1);
  });
});
