import { describe, expect, it } from 'vitest';
import { applyReecePackPricing, reecePackHint } from './reeceCandidates';
import type { Material } from './types';

function row(over: Partial<Material>): Material {
  return {
    id: 'm1',
    name: 'x',
    searchTerm: 'x',
    quantity: 1,
    unit: 'each',
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
    description: 'Available at Reece Plumbing',
    ...over,
  } as Material;
}

describe('reecePackHint', () => {
  it('reads a bracketed count on a bag or pack', () => {
    expect(reecePackHint('Sharkbite Pex Clip Masonry Nail 16mm     (100)', 'BAG')).toEqual({ packSize: 100, packUnit: 'each' });
    expect(reecePackHint('Silverback Copper Saddle Clip Nylon      Coated 20mm (200)', 'PACK')).toEqual({ packSize: 200, packUnit: 'each' });
  });

  it('ignores a bracketed number when the unit of measure is not a pack', () => {
    expect(reecePackHint('Sharkbite Pex Clip Masonry Nail 16mm (100)', 'EA')).toBeNull();
  });

  it('treats a per-metre unit of measure as a one-metre purchase', () => {
    expect(reecePackHint('Stormwater Pipe PVC Slotted 90mm (MTR)', 'MTR')).toEqual({ packSize: 1, packUnit: 'm' });
  });

  it('reads the stock length on a length, coil or roll', () => {
    expect(reecePackHint('Kembla Hard Drawn Copper Tube 20mm x 1.02mm x 6mtr Plain Type B', 'LEN')).toEqual({ packSize: 6, packUnit: 'm' });
    expect(reecePackHint('Auspex Pipe PEX 100 20mm x 50mtr', 'COIL')).toEqual({ packSize: 50, packUnit: 'm' });
  });
});

describe('applyReecePackPricing', () => {
  it('buys one bag of 100 clips for 100 clips, not 100 bags (29 Sep, $2,305)', () => {
    const m = row({ name: 'Sharkbite Pex Clip Masonry Nail 16mm (100)', quantity: 100, price: 23.05 });
    applyReecePackPricing(m, m.name, 'BAG');
    expect(m.quantity).toBe(1);
    expect(m.totalPrice).toBe(23.05);
    expect(m.requiredQty).toBe(100);
  });

  it('divides a metre requirement into coils', () => {
    const m = row({ name: 'Auspex Pipe PEX 100 20mm x 50mtr', quantity: 56, unit: 'm', price: 280.61 });
    applyReecePackPricing(m, m.name, 'COIL');
    expect(m.quantity).toBe(2);
    expect(m.totalPrice).toBe(561.22);
  });

  it('buys one flagged container when the count cannot be read', () => {
    const m = row({ name: 'Sky Silver Tip Brazing Alloy 11.34kg Box (5% Equivalent)', quantity: 12, price: 214.75 });
    applyReecePackPricing(m, m.name, 'CTN');
    expect(m.quantity).toBe(1);
    expect(m.totalPrice).toBe(214.75);
    expect(m.priceConfidence).toBe('low');
    expect(m.description).toContain('check it covers 12 each');
  });

  it('leaves a per-item fitting alone', () => {
    const m = row({ name: 'DWV Bend 100mm x 90 Degree Female & Female Plain', quantity: 8, price: 2.97 });
    applyReecePackPricing(m, m.name, 'EA');
    expect(m.quantity).toBe(8);
    expect(m.totalPrice).toBe(23.76);
    expect(m.priceConfidence).toBeUndefined();
  });
});
