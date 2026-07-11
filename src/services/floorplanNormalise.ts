import { FloorplanAnalysis } from '../types';

/**
 * Coerce a raw floorplanAnalysis blob from the LLM into our typed shape, or
 * undefined when no plan was detected. Keeps only sane numeric values so a
 * hallucinated area never silently inflates quantities downstream.
 *
 * Pure + dependency-free (no react-native/firebase/@env) so it's unit-testable
 * in isolation; re-exported from llmService for callers.
 */
export function normaliseFloorplanAnalysis(raw: any): FloorplanAnalysis | undefined {
  if (!raw || typeof raw !== 'object' || raw.detected !== true) return undefined;
  const num = (v: any): number | undefined => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const confidence: FloorplanAnalysis['confidence'] =
    raw.confidence === 'high' || raw.confidence === 'low' ? raw.confidence : 'medium';
  const zones = Array.isArray(raw.zones)
    ? raw.zones
        .map((z: any) => ({
          label: (z?.label || z?.code || 'Zone').toString(),
          code: z?.code ? z.code.toString() : undefined,
          areaM2: num(z?.areaM2),
          perimeterM: num(z?.perimeterM),
          openingsDeductionM: num(z?.openingsDeductionM),
          removalAreaM2: num(z?.removalAreaM2),
          dims:
            num(z?.dims?.lengthM) && num(z?.dims?.widthM)
              ? { lengthM: num(z.dims.lengthM)!, widthM: num(z.dims.widthM)! }
              : undefined,
        }))
        .slice(0, 100)
    : undefined;
  return {
    detected: true,
    scale: raw.scale ? raw.scale.toString() : undefined,
    calibration:
      raw.calibration && typeof raw.calibration === 'object'
        ? {
            source:
              raw.calibration.source === 'scale_bar' ||
              raw.calibration.source === 'known_dimension' ||
              raw.calibration.source === 'stated_total'
                ? raw.calibration.source
                : 'stated_total',
            basisMm: num(raw.calibration.basisMm),
            statedLengthMm: num(raw.calibration.statedLengthMm),
            note: (raw.calibration.note || '').toString(),
          }
        : undefined,
    footprintDims:
      num(raw.footprintDims?.lengthM) && num(raw.footprintDims?.widthM)
        ? { lengthM: num(raw.footprintDims.lengthM)!, widthM: num(raw.footprintDims.widthM)! }
        : undefined,
    totalAreaM2: num(raw.totalAreaM2),
    perimeterM: num(raw.perimeterM),
    zones: zones && zones.length ? zones : undefined,
    removalAreaM2: num(raw.removalAreaM2),
    removalBinM3: num(raw.removalBinM3),
    scaledToAnchor: raw.scaledToAnchor === true ? true : undefined,
    scaleFactorApplied: num(raw.scaleFactorApplied),
    source: raw.source === 'model' || raw.source === 'user' ? raw.source : undefined,
    assumptions: (raw.assumptions || '').toString(),
    confidence,
  };
}
