/**
 * Coverage-based quantity calculation.
 *
 * Used wherever a tradie measures the job in area/length/volume and the
 * priced product is sold per pack with a known coverage spec — insulation
 * bags (m² per bag), tile boxes (m² per box), decking lengths (lm/m²),
 * paint (L/m²), etc.
 *
 * Pure functions. Inputs are validated to return safe defaults (0/empty)
 * so the calling UI never has to special-case NaN/Infinity itself.
 */

export interface CoverageInput {
  /** Total area (or length / volume) the tradie measured at site. */
  area: number;
  /** How much area/length/volume a single unit (bag/box/sheet) covers. */
  coveragePerUnit: number;
  /**
   * Some suppliers only deliver in pack multiples — bags of insulation
   * by the 5/10/20, full pallets, etc. Default 1 (no rounding).
   */
  roundingIncrement?: number;
  /**
   * Extra % added to account for cuts and offcuts. Default 0.
   * Provided so the helper is future-proof; current UI doesn't surface it.
   */
  wastagePercent?: number;
}

export interface CoverageResult {
  /** Raw fractional units needed (area * (1 + wastage) / coveragePerUnit). */
  unitsRequired: number;
  /** Units actually ordered, rounded up to the next pack increment. */
  unitsToOrder: number;
  /** Area covered by `unitsToOrder` units. */
  coveredArea: number;
  /** coveredArea - area. Always >= 0. */
  surplus: number;
}

/**
 * Round up to the next multiple of `increment`.
 * `increment` <= 0 is treated as 1.
 */
function ceilToIncrement(value: number, increment: number): number {
  const inc = increment > 0 ? increment : 1;
  return Math.ceil(value / inc) * inc;
}

export function calculateUnits(input: CoverageInput): CoverageResult {
  const area = Number.isFinite(input.area) ? Math.max(0, input.area) : 0;
  const coveragePerUnit = Number.isFinite(input.coveragePerUnit)
    ? input.coveragePerUnit
    : 0;
  const roundingIncrement = Number.isFinite(input.roundingIncrement as number)
    ? (input.roundingIncrement as number)
    : 1;
  const wastagePercent = Number.isFinite(input.wastagePercent as number)
    ? Math.max(0, input.wastagePercent as number)
    : 0;

  if (area <= 0 || coveragePerUnit <= 0) {
    return { unitsRequired: 0, unitsToOrder: 0, coveredArea: 0, surplus: 0 };
  }

  const withWastage = area * (1 + wastagePercent / 100);
  const unitsRequired = withWastage / coveragePerUnit;
  const unitsToOrder = ceilToIncrement(unitsRequired, roundingIncrement);
  const coveredArea = unitsToOrder * coveragePerUnit;
  const surplus = Math.max(0, coveredArea - area);

  return {
    unitsRequired,
    unitsToOrder,
    coveredArea,
    surplus,
  };
}

/**
 * Format a human-friendly summary line: "10 bags (covers 175.5 m², surplus 5.5)".
 * `unitLabel` is the noun ("bag", "box"). `coverageUnit` is "m²" / "m" / "m³".
 */
export function formatCoverageSummary(
  result: CoverageResult,
  unitLabel: string,
  coverageUnit: string
): string {
  if (result.unitsToOrder <= 0) return '';
  const plural = result.unitsToOrder === 1 ? unitLabel : `${unitLabel}s`;
  const cov = result.coveredArea.toFixed(1);
  const sur = result.surplus.toFixed(1);
  return `${result.unitsToOrder} ${plural} (covers ${cov} ${coverageUnit}, surplus ${sur} ${coverageUnit})`;
}
