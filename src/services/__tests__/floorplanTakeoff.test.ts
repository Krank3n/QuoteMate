import { describe, it, expect } from 'vitest';
import { resolvedTakeoff, floorplanQuantityForUnit } from '../floorplanTakeoff';
import { FloorplanAnalysis } from '../../types';

function base(overrides: Partial<FloorplanAnalysis>): FloorplanAnalysis {
  return {
    detected: true,
    assumptions: '',
    confidence: 'medium',
    ...overrides,
  };
}

describe('resolvedTakeoff', () => {
  it('returns model values when no corrected overrides exist', () => {
    const analysis = base({ totalAreaM2: 100, perimeterM: 40, removalBinM3: 5 });
    const r = resolvedTakeoff(analysis);
    expect(r.totalAreaM2).toBe(100);
    expect(r.perimeterM).toBe(40);
    expect(r.removalBinM3).toBe(5);
  });

  it('returns corrected values field-by-field when corrected present', () => {
    const analysis = base({
      totalAreaM2: 100,
      perimeterM: 40,
      removalBinM3: 5,
      corrected: { totalAreaM2: 120, removalBinM3: 8, editedAt: '2026-06-21T00:00:00Z' },
    });
    const r = resolvedTakeoff(analysis);
    expect(r.totalAreaM2).toBe(120); // overridden
    expect(r.perimeterM).toBe(40); // falls through to model
    expect(r.removalBinM3).toBe(8); // overridden
  });
});

describe('floorplanQuantityForUnit', () => {
  const analysis = base({ totalAreaM2: 100, perimeterM: 40, removalBinM3: 5 });

  it('maps m² → totalAreaM2, m → perimeterM, m³ → removalBinM3', () => {
    expect(floorplanQuantityForUnit(analysis, 'm²')).toBe(100);
    expect(floorplanQuantityForUnit(analysis, 'm')).toBe(40);
    expect(floorplanQuantityForUnit(analysis, 'm³')).toBe(5);
  });

  it('returns undefined when the field is missing', () => {
    const partial = base({ totalAreaM2: 100 });
    expect(floorplanQuantityForUnit(partial, 'm')).toBeUndefined();
    expect(floorplanQuantityForUnit(partial, 'm³')).toBeUndefined();
  });
});
