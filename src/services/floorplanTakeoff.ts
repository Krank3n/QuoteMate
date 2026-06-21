import { FloorplanAnalysis } from '../types';

/**
 * Resolve the takeoff numbers to use, preferring any user-edited `corrected`
 * overrides over the model-measured values field-by-field. Zone editing is
 * deferred, so zones pass through as-is.
 */
export function resolvedTakeoff(analysis: FloorplanAnalysis) {
  const c = analysis.corrected;
  return {
    totalAreaM2: c?.totalAreaM2 ?? analysis.totalAreaM2,
    perimeterM: c?.perimeterM ?? analysis.perimeterM,
    removalBinM3: c?.removalBinM3 ?? analysis.removalBinM3,
    zones: analysis.zones, // zones editing deferred
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
