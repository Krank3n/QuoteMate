import { describe, expect, it } from 'vitest';
import { applyPackAwarePricing } from './packAwarePricing';
import { Material } from '../types';

function mat(quantity: number, unit: Material['unit'], price = 12): Material {
  return {
    id: 'm1',
    name: 'Rapid Set Concrete',
    quantity,
    unit,
    price,
    totalPrice: quantity * price,
    manualPriceOverride: false,
  } as Material;
}

describe('applyPackAwarePricing', () => {
  it('converts each-count length products when the requested each has a nominal length', () => {
    const m = mat(2, 'each', 18.57);
    m.name = 'Sliding Gate Track 3m';
    applyPackAwarePricing(m, {
      productName: 'Richmond 1m Bolt Down Gate Track for Sliding Gates',
      packSize: 1,
      packUnit: 'm',
    });
    expect(m.quantity).toBe(6);
    expect(m.unit).toBe('each');
    expect(m.packSize).toBe(1);
    expect(m.packUnit).toBe('m');
  });

  it('prefers compatible title pack info over incompatible scraper yield metadata', () => {
    const m = mat(240, 'kg', 12.48);
    applyPackAwarePricing(m, {
      productName: 'Dingo 10kg Fast Set Hi-Strength Concrete',
      packSize: 1.1,
      packUnit: 'L',
    });
    expect(m.quantity).toBe(24);
    expect(m.unit).toBe('pack');
    expect(m.packSize).toBe(10);
    expect(m.packUnit).toBe('kg');
    expect(m.totalPrice).toBe(299.52);
  });
});

/**
 * Re-pricing must not corrupt a row that already converted correctly.
 *
 * applyPackAwarePricing overwrites `material.unit` with a PURCHASE unit
 * ('pack'/'each') when it divides. It then used to re-read that same `unit` on
 * the next call to decide whether the product's pack size was compatible — so
 * a second pass over a converted row saw 'pack' (→ 'each'), compared it against
 * the product's 'kg', called them incompatible, and took the no-division branch
 * that assigns quantity = requiredQty outright.
 *
 * On the fence quote that followed QU-178692 that turned a 440 kg concrete
 * requirement into 440 BAGS — $4,048.00 of quick-set for an 11-bay fence,
 * while the identical product in a neighbouring section sat correctly at 2.
 *
 * `requiredUnit` is captured on the first pass for exactly this reason; the
 * compatibility check has to use it.
 */
describe('applyPackAwarePricing is idempotent', () => {
  const BAG = { productName: 'Rapid Set Concrete 20kg', packSize: 20, packUnit: 'kg' };

  it('keeps a 440 kg requirement at 22 bags across repeated pricing passes', () => {
    const m = mat(440, 'kg', 9.2);

    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(22);
    expect(m.unit).toBe('pack');
    expect(m.requiredQty).toBe(440);
    expect(m.requiredUnit).toBe('kg');

    // The re-price that used to blow it out to 440 bags.
    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(22);
    expect(m.unit).toBe('pack');
    expect(m.packSize).toBe(20);
    expect(m.packUnit).toBe('kg');
    expect(m.totalPrice).toBe(202.4);

    // And a third, for good measure.
    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(22);
  });

  it('recomputes from the requirement, not the previous pack count, when the pack size changes', () => {
    const m = mat(440, 'kg', 9.2);
    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(22);

    // Re-priced against a 40kg bag: 440 / 40 = 11, derived from the 440 kg
    // requirement rather than from the 22 packs now sitting in `quantity`.
    applyPackAwarePricing(m, { productName: 'Rapid Set Concrete 40kg', packSize: 40, packUnit: 'kg' });
    expect(m.quantity).toBe(11);
    expect(m.packSize).toBe(40);
  });

  it('still refuses to divide an each-requirement by a kg pack, on every pass', () => {
    // "60 each" concrete bags against a 20kg SKU must never become 3.
    const m = mat(60, 'each', 9.2);

    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(60);
    expect(m.packSize).toBeUndefined();

    applyPackAwarePricing(m, BAG);
    expect(m.quantity).toBe(60);
    expect(m.packSize).toBeUndefined();
  });

  it('keeps a linear each→metre conversion stable across passes', () => {
    const m = mat(7, 'each', 18);
    m.name = 'Colorbond Fence Rail 2.4m';
    const RAIL = { productName: 'Fence Rail 4.8m length', packSize: 4.8, packUnit: 'm' };

    applyPackAwarePricing(m, RAIL);
    const afterFirst = m.quantity;
    applyPackAwarePricing(m, RAIL);
    expect(m.quantity).toBe(afterFirst);
  });
});
