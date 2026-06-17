import { describe, it, expect } from 'vitest';
import { computeLabourFromPreset, formatPresetRate, shouldAutoConvertHoursToDays } from '../labourPreset';
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
  it("ceiling example: 240 m² × $1500 / 100 m² = $3,600", () => {
    expect(computeLabourFromPreset(ceilingPreset, 240)).toBe(3600);
  });

  it("floor example at 50 m²", () => {
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

describe('shouldAutoConvertHoursToDays', () => {
  const base = { alreadyInDays: false, totalStored: 8, rateForInput: 100, hasLabourPresetSnapshot: false };

  it('converts a plain hours-mode quote at the 6h threshold', () => {
    expect(shouldAutoConvertHoursToDays(base)).toBe(true);
    expect(shouldAutoConvertHoursToDays({ ...base, totalStored: 6 })).toBe(true);
  });

  it('leaves short quotes alone', () => {
    expect(shouldAutoConvertHoursToDays({ ...base, totalStored: 4 })).toBe(false);
  });

  it('never converts a quote already stored in days', () => {
    expect(shouldAutoConvertHoursToDays({ ...base, alreadyInDays: true })).toBe(false);
  });

  it('does not convert when a labour-preset snapshot is present (QU-177892 regression)', () => {
    // Preset apply used to stash the whole job total in laborRate with
    // laborHours: 1; once that quote rehydrated into the screen and the
    // section sum hit 6h, the old code multiplied that lump-sum rate by 8
    // and turned a $37,500 paint job into $300,000 of labour.
    expect(
      shouldAutoConvertHoursToDays({
        alreadyInDays: false,
        totalStored: 8,
        rateForInput: 37500,
        hasLabourPresetSnapshot: true,
      }),
    ).toBe(false);
  });

  it('does not convert when the rate looks like a lump sum (> $500/hr)', () => {
    expect(
      shouldAutoConvertHoursToDays({
        alreadyInDays: false,
        totalStored: 8,
        rateForInput: 1500,
        hasLabourPresetSnapshot: false,
      }),
    ).toBe(false);
  });
});
