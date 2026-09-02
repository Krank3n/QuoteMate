import { describe, it, expect } from 'vitest';
import { isTradieRow, resetGeneratedScope } from './scopeReset';
import type { Material, Quote } from '../types';

function row(over: Partial<Material>): Material {
  return {
    id: over.id || 'm',
    name: 'Treated pine post 100x100',
    quantity: 1,
    unit: 'each',
    price: 20,
    totalPrice: 20,
    manualPriceOverride: false,
    ...over,
  } as Material;
}

const generated = [
  row({ id: 'g1', section: 'Fence' }),
  row({ id: 'g2', section: 'Fence', name: 'Paling 100x12' }),
  row({ id: 'g3', section: 'Concrete', name: 'Rapid set concrete' }),
];

function quote(materials: Material[]): Quote {
  return {
    id: 'q1',
    status: 'draft',
    job: { id: 'j1', name: 'Fence', description: '10 m' },
    materials,
    laborHours: 14,
    sections: [
      { id: 's1', name: 'Fence', multiplier: 1, laborHours: 10, laborRate: 120, laborUnit: 'hours', laborTotal: 1200, sortOrder: 0 },
      { id: 's2', name: 'Concrete', multiplier: 1, laborHours: 4, laborRate: 120, laborUnit: 'hours', laborTotal: 480, sortOrder: 1 },
    ],
  } as unknown as Quote;
}

describe('resetGeneratedScope', () => {
  it('drops every generated row and section, and restarts labour at zero', () => {
    const out = resetGeneratedScope(quote(generated));
    expect(out.materials).toEqual([]);
    expect(out.sections).toEqual([]);
    expect(out.laborHours).toBe(0);
  });

  it('keeps rows the tradie priced or added, and the sections they sit in', () => {
    const mine = row({ id: 'mine', section: 'Concrete', name: 'My own concrete price', manualPriceOverride: true, price: 99 });
    const added = row({ id: 'added', name: 'Skip bin', origin: 'manual' });
    const out = resetGeneratedScope(quote([...generated, mine, added]));
    expect(out.materials.map((m) => m.id)).toEqual(['mine', 'added']);
    expect(out.sections?.map((s) => s.name)).toEqual(['Concrete']);
  });

  it('seeds the corrected hours when the tradie gave them', () => {
    expect(resetGeneratedScope(quote(generated), 6).laborHours).toBe(6);
    expect(resetGeneratedScope(quote(generated), 0).laborHours).toBe(0);
  });

  it('leaves a quote with no sections field without one', () => {
    const q = { ...quote(generated), sections: undefined } as Quote;
    expect('sections' in resetGeneratedScope(q) && resetGeneratedScope(q).sections).toBeUndefined();
  });

  it('isTradieRow reads either marker', () => {
    expect(isTradieRow({ origin: 'manual', manualPriceOverride: false })).toBe(true);
    expect(isTradieRow({ manualPriceOverride: true })).toBe(true);
    expect(isTradieRow({ manualPriceOverride: false })).toBe(false);
    expect(isTradieRow({ origin: 'recommended', manualPriceOverride: false })).toBe(false);
  });
});
