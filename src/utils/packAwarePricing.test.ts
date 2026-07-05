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
