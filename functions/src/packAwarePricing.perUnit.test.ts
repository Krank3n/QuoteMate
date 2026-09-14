import { describe, expect, it } from 'vitest';
import { normaliseEstimateResponse } from './shared/pricing/estimate';
import { applyPackAwarePricing } from './shared/pricing/packAwarePricing';
import type { Material } from './shared/pricing/types';

/**
 * The server-side pricing run (pricingRun.ts) reaches the pack step through
 * ./shared/pricing/pipeline, and src/shared is a symlink to the repo-root
 * shared/ package — so the Cloud Function and the app run the SAME helper.
 * This suite pins the per-unit behaviour on the server's own import path,
 * fed the way the searchMaterialPrice handler feeds it: an estimator answer
 * normalised by normaliseEstimateResponse.
 */
function requirement(name: string, quantity: number, unit: Material['unit'], price: number): Material {
  return {
    id: 'm1',
    name,
    quantity,
    unit,
    price,
    totalPrice: quantity * price,
    manualPriceOverride: false,
    requiredQty: quantity,
    requiredUnit: unit,
  } as Material;
}

describe('server pricing run: goods priced per the requirement unit', () => {
  it('buys 3 m³ of a per-cubic-metre product for a 3 m³ requirement, not 1', () => {
    const est = normaliseEstimateResponse({
      price: 59.09,
      productName: 'Bulk Hardwood Bark Mulch (per cubic metre, bulk delivery)',
      packSize: 1,
      packUnit: 'each',
    });
    const m = requirement('Garden mulch', 3, 'm³', est.price!);
    applyPackAwarePricing(m, { productName: est.productName, packSize: est.packSize, packUnit: est.packUnit });
    expect(m.quantity).toBe(3);
    expect(m.totalPrice).toBeCloseTo(177.27, 2);
    expect(m.description ?? '').not.toContain('one purchase');
  });

  it('honours a per-unit pack the estimator states outright as ASCII m3', () => {
    const est = normaliseEstimateResponse({
      price: 59.09,
      productName: 'Bulk Hardwood Bark Mulch',
      packSize: 1,
      packUnit: 'm3',
    });
    const m = requirement('Garden mulch', 3, 'm³', est.price!);
    applyPackAwarePricing(m, { productName: est.productName, packSize: est.packSize, packUnit: est.packUnit });
    expect(m.quantity).toBe(3);
  });

  it('still buys one bag whose stated coverage exceeds the requirement', () => {
    const est = normaliseEstimateResponse({
      price: 45.9,
      productName: 'Flexible Tile Adhesive 20kg Bag (covers 3 m² per bag)',
      packSize: 20,
      packUnit: 'kg',
    });
    const m = requirement('Tile adhesive', 2, 'm²', est.price!);
    applyPackAwarePricing(m, { productName: est.productName, packSize: est.packSize, packUnit: est.packUnit });
    expect(m.quantity).toBe(1);
    expect(m.totalPrice).toBeCloseTo(45.9, 2);
  });

  it('leaves a discrete piece-good counted in each untouched', () => {
    const est = normaliseEstimateResponse({
      price: 24.5,
      productName: 'Treated Pine Post H4 100x100mm 2.4m',
      packSize: 1,
      packUnit: 'each',
    });
    const m = requirement('Fence posts', 7, 'each', est.price!);
    applyPackAwarePricing(m, { productName: est.productName, packSize: est.packSize, packUnit: est.packUnit });
    expect(m.quantity).toBe(7);
    expect(m.totalPrice).toBeCloseTo(171.5, 2);
  });

  it('keeps the requirement, flagged, when coverage is unknown', () => {
    const est = normaliseEstimateResponse({
      price: 59.09,
      productName: 'Bulk Hardwood Bark Mulch',
      packSize: 1,
      packUnit: 'each',
    });
    const m = requirement('Garden mulch', 3, 'm³', est.price!);
    applyPackAwarePricing(m, { productName: est.productName, packSize: est.packSize, packUnit: est.packUnit });
    expect(m.quantity).toBe(3);
    expect(m.priceConfidence).toBe('low');
    expect(m.description).toContain('check it covers 3 m³');
  });
});
