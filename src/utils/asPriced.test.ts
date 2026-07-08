import { describe, it, expect } from 'vitest';
import { stampAsPriced } from './asPriced';
import { Material } from '../types';

const mat = (over: Partial<Material> = {}): Material => ({
  id: 'm1',
  name: 'Treated Pine Post 2.4m',
  quantity: 7,
  unit: 'each',
  price: 32.9,
  totalPrice: 230.3,
  manualPriceOverride: false,
  pricingSource: 'scraper',
  priceConfidence: 'high',
  ...over,
});

describe('stampAsPriced', () => {
  it('snapshots pipeline-priced rows including provenance', () => {
    const m = mat();
    stampAsPriced([m]);
    expect(m.asPriced).toEqual({
      price: 32.9,
      quantity: 7,
      name: 'Treated Pine Post 2.4m',
      pricingSource: 'scraper',
      priceConfidence: 'high',
    });
  });

  it('clears the snapshot on hand-priced rows — they are not pipeline output', () => {
    const m = mat({
      manualPriceOverride: true,
      asPriced: { price: 1, quantity: 1, name: 'stale' },
    });
    stampAsPriced([m]);
    expect(m.asPriced).toBeUndefined();
  });

  it('overwrites a previous snapshot — a re-price resets the baseline', () => {
    const m = mat({ asPriced: { price: 10, quantity: 1, name: 'old' } });
    stampAsPriced([m]);
    expect(m.asPriced?.price).toBe(32.9);
  });
});
