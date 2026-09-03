import { FloorplanAnalysis, FloorplanZone, Material } from './types';

/**
 * Resolve the takeoff numbers to use, preferring any user-edited `corrected`
 * overrides over the model-measured values field-by-field. When the user
 * accepted "scale the other areas to match" after correcting the total,
 * `corrected.zonesScaledBy` (an area factor) is applied to the stored zone
 * measurements at read time — zone areas by the factor, zone lengths by its
 * square root. The stored model values are never mutated.
 */
export function resolvedTakeoff(analysis: FloorplanAnalysis) {
  const c = analysis.corrected;
  const zoneAreaFactor =
    typeof c?.zonesScaledBy === 'number' && isFinite(c.zonesScaledBy) && c.zonesScaledBy > 0
      ? c.zonesScaledBy
      : undefined;
  const zoneLengthFactor = zoneAreaFactor !== undefined ? Math.sqrt(zoneAreaFactor) : undefined;

  const zones =
    zoneAreaFactor === undefined
      ? analysis.zones
      : analysis.zones?.map((z): FloorplanZone => ({
          ...z,
          areaM2: typeof z.areaM2 === 'number' ? z.areaM2 * zoneAreaFactor : z.areaM2,
          removalAreaM2:
            typeof z.removalAreaM2 === 'number' ? z.removalAreaM2 * zoneAreaFactor : z.removalAreaM2,
          perimeterM:
            typeof z.perimeterM === 'number' ? z.perimeterM * zoneLengthFactor! : z.perimeterM,
          openingsDeductionM:
            typeof z.openingsDeductionM === 'number'
              ? z.openingsDeductionM * zoneLengthFactor!
              : z.openingsDeductionM,
          dims: z.dims
            ? { lengthM: z.dims.lengthM * zoneLengthFactor!, widthM: z.dims.widthM * zoneLengthFactor! }
            : z.dims,
        }));

  return {
    totalAreaM2: c?.totalAreaM2 ?? analysis.totalAreaM2,
    perimeterM: c?.perimeterM ?? analysis.perimeterM,
    removalBinM3: c?.removalBinM3 ?? analysis.removalBinM3,
    zones,
    confidence: analysis.confidence,
    assumptions: analysis.assumptions,
  };
}

/**
 * Pick the resolved takeoff quantity that matches a measure unit, or undefined
 * when that quantity isn't available.
 */
export function floorplanQuantityForUnit(
  analysis: FloorplanAnalysis,
  unit: 'm²' | 'm' | 'm³',
): number | undefined {
  const resolved = resolvedTakeoff(analysis);
  if (unit === 'm²') return resolved.totalAreaM2;
  if (unit === 'm') return resolved.perimeterM;
  if (unit === 'm³') return resolved.removalBinM3;
  return undefined;
}

/**
 * Carry the user's corrections forward onto a freshly generated analysis, so
 * re-running "Get Recommended Gear" (or a re-upload) can never silently wipe
 * an edit the tradie made. Model fields always come from the new analysis.
 */
export function withPreservedCorrections(
  next: FloorplanAnalysis,
  prev: FloorplanAnalysis | undefined,
): FloorplanAnalysis {
  if (!prev?.corrected) return next;
  return { ...next, corrected: { ...prev.corrected } };
}

/** Which geometry basis a takeoff metric drives when the user corrects it. */
export type TakeoffEditField = 'totalAreaM2' | 'perimeterM' | 'removalBinM3';

const FIELD_BASIS: Record<TakeoffEditField, 'area' | 'perimeter' | 'volume'> = {
  totalAreaM2: 'area',
  perimeterM: 'perimeter',
  removalBinM3: 'volume',
};

/**
 * Rescale the material quantities that were grounded on the plan geometry a
 * corrected metric drives: total area → planBasis 'area', perimeter →
 * 'perimeter', waste volume → 'volume'. `ratio` is corrected ÷ previous value
 * of that metric. Mirrors the server-side scaleMaterialsToAnchor field
 * selection: when the geometry lives in sectionMultiplier (> 1) scale that,
 * otherwise the per-unit quantity/requiredQty. Untouched: 'fixed' and untagged
 * rows. Pack rounding is intentionally not re-derived here — the pricing
 * pipeline re-rounds packs when prices are next fetched/reconciled.
 */
export function scaleMaterialsForTakeoffCorrection(
  materials: Material[],
  field: TakeoffEditField,
  ratio: number,
): Material[] {
  if (!isFinite(ratio) || ratio <= 0 || Math.abs(ratio - 1) < 0.001) return materials;
  const basis = FIELD_BASIS[field];

  return materials.map((m) => {
    if ((m.planBasis || '') !== basis) return m;

    const round = (n: number) => Math.round(n * ratio * 1000) / 1000;
    const next: Material = { ...m };
    const sectionMultiplier = (m as any).sectionMultiplier;

    if (typeof sectionMultiplier === 'number' && sectionMultiplier > 1) {
      (next as any).sectionMultiplier = round(sectionMultiplier);
    } else {
      next.quantity = round(m.quantity);
      if (typeof m.requiredQty === 'number') next.requiredQty = round(m.requiredQty);
    }
    next.totalPrice = Math.round(next.quantity * (next.price || 0) * 100) / 100;
    next.quantityScaledToAnchor = true;
    return next;
  });
}
