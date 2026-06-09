import { describe, it, expect } from 'vitest';
import { calculateUnits, formatCoverageSummary } from '../coverageCalc';

describe('calculateUnits', () => {
  it('rounds up to whole units by default (increment 1)', () => {
    const r = calculateUnits({ area: 100, coveragePerUnit: 13.5 });
    // 100 / 13.5 = 7.407 → 8
    expect(r.unitsRequired).toBeCloseTo(7.407, 2);
    expect(r.unitsToOrder).toBe(8);
    expect(r.coveredArea).toBe(108);
    expect(r.surplus).toBe(8);
  });

  it('rounds up to the next pack increment of 5', () => {
    // 100 / 13.5 = 7.4 → next multiple of 5 = 10
    expect(calculateUnits({ area: 100, coveragePerUnit: 13.5, roundingIncrement: 5 }).unitsToOrder).toBe(10);
  });

  it('rounds up to the next pack increment of 10', () => {
    expect(calculateUnits({ area: 100, coveragePerUnit: 13.5, roundingIncrement: 10 }).unitsToOrder).toBe(10);
    // 200 / 13.5 = 14.8 → next 10 = 20
    expect(calculateUnits({ area: 200, coveragePerUnit: 13.5, roundingIncrement: 10 }).unitsToOrder).toBe(20);
  });

  it('rounds up to the next pack increment of 20', () => {
    expect(calculateUnits({ area: 100, coveragePerUnit: 13.5, roundingIncrement: 20 }).unitsToOrder).toBe(20);
  });

  it('handles exact-fit areas without bumping a whole pack', () => {
    // 135 / 13.5 = exactly 10
    const r = calculateUnits({ area: 135, coveragePerUnit: 13.5, roundingIncrement: 5 });
    expect(r.unitsToOrder).toBe(10);
    expect(r.surplus).toBe(0);
  });

  it('returns zeros for zero/negative area', () => {
    expect(calculateUnits({ area: 0, coveragePerUnit: 13.5 }).unitsToOrder).toBe(0);
    expect(calculateUnits({ area: -10, coveragePerUnit: 13.5 }).unitsToOrder).toBe(0);
  });

  it('returns zeros when coveragePerUnit is missing or zero', () => {
    expect(calculateUnits({ area: 100, coveragePerUnit: 0 }).unitsToOrder).toBe(0);
    expect(calculateUnits({ area: 100, coveragePerUnit: NaN }).unitsToOrder).toBe(0);
  });

  it('applies wastage percent before rounding', () => {
    // 100 m² + 10% wastage = 110 m² → 110 / 13.5 = 8.15 → 9 units
    const r = calculateUnits({ area: 100, coveragePerUnit: 13.5, wastagePercent: 10 });
    expect(r.unitsToOrder).toBe(9);
  });

  it('treats invalid roundingIncrement as 1', () => {
    expect(calculateUnits({ area: 100, coveragePerUnit: 13.5, roundingIncrement: 0 }).unitsToOrder).toBe(8);
    expect(calculateUnits({ area: 100, coveragePerUnit: 13.5, roundingIncrement: -5 }).unitsToOrder).toBe(8);
  });
});

describe('formatCoverageSummary', () => {
  it('formats a multi-unit summary', () => {
    const r = calculateUnits({ area: 100, coveragePerUnit: 13.5, roundingIncrement: 5 });
    expect(formatCoverageSummary(r, 'bag', 'm²')).toBe('10 bags (covers 135.0 m², surplus 35.0 m²)');
  });

  it('uses singular for one unit', () => {
    const r = calculateUnits({ area: 10, coveragePerUnit: 13.5 });
    expect(formatCoverageSummary(r, 'bag', 'm²').startsWith('1 bag ')).toBe(true);
  });

  it('returns empty string when no units required', () => {
    const r = calculateUnits({ area: 0, coveragePerUnit: 13.5 });
    expect(formatCoverageSummary(r, 'bag', 'm²')).toBe('');
  });
});
