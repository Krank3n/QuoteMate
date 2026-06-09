import { describe, it, expect } from 'vitest';
import { computeLabourFromPreset, formatPresetRate } from '../labourPreset';
import type { LabourRatePreset } from '../../types';

const ceilingPreset: LabourRatePreset = {
  id: 'c',
  name: 'Ceiling insulation',
  amount: 1500,
  denominator: 100,
  unit: 'm²',
};

const floorPreset: LabourRatePreset = {
  id: 'f',
  name: 'Floor insulation',
  amount: 2500,
  denominator: 100,
  unit: 'm²',
};

describe('computeLabourFromPreset', () => {
  it("matches Jesse's ceiling example: 240 m² × $1500 / 100 m² = $3,600", () => {
    expect(computeLabourFromPreset(ceilingPreset, 240)).toBe(3600);
  });

  it("matches Jesse's floor example at 50 m²", () => {
    expect(computeLabourFromPreset(floorPreset, 50)).toBe(1250);
  });

  it('rounds to 2 decimal places', () => {
    // 33.33 m² × $1500/100m² = $499.95
    expect(computeLabourFromPreset(ceilingPreset, 33.33)).toBe(499.95);
  });

  it('returns 0 for zero/negative measured area', () => {
    expect(computeLabourFromPreset(ceilingPreset, 0)).toBe(0);
    expect(computeLabourFromPreset(ceilingPreset, -5)).toBe(0);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(computeLabourFromPreset(ceilingPreset, NaN)).toBe(0);
    expect(computeLabourFromPreset({ ...ceilingPreset, denominator: 0 }, 100)).toBe(0);
  });

  it('handles fractional denominators', () => {
    // $20 per 0.5 m² → $40 / m². 5 m² → $200.
    const p: LabourRatePreset = { id: 'x', name: 'x', amount: 20, denominator: 0.5, unit: 'm²' };
    expect(computeLabourFromPreset(p, 5)).toBe(200);
  });
});

describe('formatPresetRate', () => {
  it('formats the ceiling preset', () => {
    expect(formatPresetRate(ceilingPreset)).toContain('100');
    expect(formatPresetRate(ceilingPreset)).toContain('m²');
  });
});
