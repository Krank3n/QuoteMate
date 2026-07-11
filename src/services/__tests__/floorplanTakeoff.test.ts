import { describe, it, expect } from 'vitest';
import {
  resolvedTakeoff,
  floorplanQuantityForUnit,
  withPreservedCorrections,
  scaleMaterialsForTakeoffCorrection,
} from '../floorplanTakeoff';
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

describe('resolvedTakeoff — zonesScaledBy', () => {
  const analysis = base({
    totalAreaM2: 760,
    zones: [
      {
        label: 'FC03 area',
        code: 'FC03',
        areaM2: 100,
        perimeterM: 90,
        openingsDeductionM: 10,
        removalAreaM2: 50,
        dims: { lengthM: 10, widthM: 10 },
      },
    ],
    corrected: { totalAreaM2: 680, zonesScaledBy: 680 / 760, editedAt: 'x' },
  });

  it('scales zone areas by the factor and zone lengths by its square root', () => {
    const f = 680 / 760;
    const sf = Math.sqrt(f);
    const z = resolvedTakeoff(analysis).zones![0];
    expect(z.areaM2).toBeCloseTo(100 * f, 6);
    expect(z.removalAreaM2).toBeCloseTo(50 * f, 6);
    expect(z.perimeterM).toBeCloseTo(90 * sf, 6);
    expect(z.openingsDeductionM).toBeCloseTo(10 * sf, 6);
    expect(z.dims!.lengthM).toBeCloseTo(10 * sf, 6);
  });

  it('never mutates the stored model zones', () => {
    resolvedTakeoff(analysis);
    expect(analysis.zones![0].areaM2).toBe(100);
    expect(analysis.zones![0].perimeterM).toBe(90);
  });

  it('ignores an invalid factor', () => {
    const bad = base({
      zones: [{ label: 'Z', areaM2: 100 }],
      corrected: { zonesScaledBy: 0, editedAt: 'x' },
    });
    expect(resolvedTakeoff(bad).zones![0].areaM2).toBe(100);
  });
});

describe('withPreservedCorrections', () => {
  it('carries corrected forward onto a fresh analysis', () => {
    const prev = base({
      totalAreaM2: 760,
      corrected: { totalAreaM2: 680, zonesScaledBy: 0.9, editedAt: 'x' },
    });
    const next = base({ totalAreaM2: 790 });
    const merged = withPreservedCorrections(next, prev);
    expect(merged.totalAreaM2).toBe(790); // model fields from the new analysis
    expect(merged.corrected).toEqual(prev.corrected);
    expect(merged.corrected).not.toBe(prev.corrected); // copied, not shared
  });

  it('returns the new analysis untouched when there is nothing to preserve', () => {
    const next = base({ totalAreaM2: 790 });
    expect(withPreservedCorrections(next, undefined)).toBe(next);
    expect(withPreservedCorrections(next, base({ totalAreaM2: 1 }))).toBe(next);
  });
});

describe('scaleMaterialsForTakeoffCorrection', () => {
  const mat = (over: any) => ({
    id: 'm1',
    name: 'X',
    quantity: 100,
    unit: 'm²' as const,
    price: 2,
    totalPrice: 200,
    manualPriceOverride: false,
    ...over,
  });

  it('REGRESSION (issue #32 Phase 3 client): total-area correction rescales area-basis rows and their totalPrice', () => {
    // Craig's case: card shows 760 m², he corrects to 680 → ratio 680/760.
    const ratio = 680 / 760;
    const [scaled] = scaleMaterialsForTakeoffCorrection(
      [mat({ planBasis: 'area', quantity: 760, requiredQty: 760, totalPrice: 1520 })],
      'totalAreaM2',
      ratio,
    );
    expect(scaled.quantity).toBeCloseTo(680, 1);
    expect(scaled.requiredQty).toBeCloseTo(680, 1);
    expect(scaled.totalPrice).toBeCloseTo(680 * 2, 1);
    expect(scaled.quantityScaledToAnchor).toBe(true);
  });

  it('scales sectionMultiplier when the geometry lives there', () => {
    const [scaled] = scaleMaterialsForTakeoffCorrection(
      [mat({ planBasis: 'area', quantity: 1, sectionMultiplier: 100 })],
      'totalAreaM2',
      1.2,
    );
    expect((scaled as any).sectionMultiplier).toBeCloseTo(120, 3);
    expect(scaled.quantity).toBe(1); // per-unit qty untouched
  });

  it('maps each edited metric to only its own basis', () => {
    const rows = [
      mat({ id: 'a', planBasis: 'area' }),
      mat({ id: 'p', planBasis: 'perimeter' }),
      mat({ id: 'v', planBasis: 'volume' }),
      mat({ id: 'f', planBasis: 'fixed' }),
      mat({ id: 'u' }),
    ];
    const afterPerim = scaleMaterialsForTakeoffCorrection(rows, 'perimeterM', 2);
    expect(afterPerim.find((m) => m.id === 'p')!.quantity).toBe(200);
    for (const id of ['a', 'v', 'f', 'u']) {
      expect(afterPerim.find((m) => m.id === id)!.quantity).toBe(100);
    }
    const afterBin = scaleMaterialsForTakeoffCorrection(rows, 'removalBinM3', 0.7);
    expect(afterBin.find((m) => m.id === 'v')!.quantity).toBeCloseTo(70, 3);
    expect(afterBin.find((m) => m.id === 'a')!.quantity).toBe(100);
  });

  it('is a no-op for a ~1 or invalid ratio', () => {
    const rows = [mat({ planBasis: 'area' })];
    expect(scaleMaterialsForTakeoffCorrection(rows, 'totalAreaM2', 1)).toBe(rows);
    expect(scaleMaterialsForTakeoffCorrection(rows, 'totalAreaM2', 0)).toBe(rows);
    expect(scaleMaterialsForTakeoffCorrection(rows, 'totalAreaM2', NaN)).toBe(rows);
  });
});
