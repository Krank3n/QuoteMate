/**
 * Anchor-scale correction for floorplan takeoffs.
 *
 * The vision model echoes the outer bounding-box dimensions it measured off the
 * plan (`footprintDims`) and a `calibration` describing the real-world anchor
 * the user supplied (a stated total or a known dimension). When the two
 * disagree the model's pixel-derived measurement is wrong by a constant linear
 * factor, so every area is off by that factor squared. We scale the whole
 * takeoff back onto the user's real-world anchor here.
 *
 * Kept as a pure, side-effect-free function (separate from index.ts) so the
 * money-path math is unit-testable in isolation. The shape mirrors
 * `FloorplanAnalysis` in src/types — declared locally because functions/ is a
 * standalone TypeScript project that doesn't include the app src tree.
 */

export interface FloorplanZone {
  label: string;
  code?: string;
  areaM2?: number;
  removalAreaM2?: number;
  dims?: { lengthM: number; widthM: number };
}

export interface FloorplanAnalysis {
  detected: boolean;
  scale?: string;
  calibration?: {
    source: 'scale_bar' | 'known_dimension' | 'stated_total';
    basisMm?: number;
    note: string;
  };
  footprintDims?: { lengthM: number; widthM: number };
  totalAreaM2?: number;
  perimeterM?: number;
  zones?: FloorplanZone[];
  removalAreaM2?: number;
  removalBinM3?: number;
  scaledToAnchor?: boolean;
  scaleFactorApplied?: number;
  source?: 'model' | 'user';
  assumptions: string;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Rescale a detected floorplan takeoff so its measurements match the
 * real-world anchor the user supplied. Returns the analysis unchanged when
 * there's no usable anchor, no usable model measurement, or the correction is
 * a no-op — so this can never regress a takeoff that was already correct.
 */
export function applyAnchorScale(analysis: FloorplanAnalysis): FloorplanAnalysis {
  // The real-world length to anchor onto: the stated *overall* footprint
  // length the tradie supplied, captured in calibration.basisMm (millimetres).
  // Only `stated_total` describes the outer footprint — `known_dimension` is a
  // labelled sub-footprint dimension (e.g. a single grid bay) and using it as
  // the footprint length would catastrophically mis-scale the whole takeoff.
  let statedLengthM: number | undefined;
  if (
    analysis.calibration &&
    analysis.calibration.source === 'stated_total' &&
    typeof analysis.calibration.basisMm === 'number' &&
    isFinite(analysis.calibration.basisMm) &&
    analysis.calibration.basisMm > 0
  ) {
    statedLengthM = analysis.calibration.basisMm / 1000;
  }
  if (statedLengthM === undefined || statedLengthM <= 0 || !isFinite(statedLengthM)) {
    return analysis;
  }

  // What the model actually measured off the plan — its outer bounding box if
  // it echoed one, else the side of a square with the same area.
  const modelAnchorLengthM =
    analysis.footprintDims?.lengthM ?? Math.sqrt(analysis.totalAreaM2 ?? 0);
  if (modelAnchorLengthM <= 0 || !isFinite(modelAnchorLengthM)) {
    return analysis;
  }

  const linearFactor = statedLengthM / modelAnchorLengthM;
  // No meaningful correction — leave the takeoff exactly as the model produced it.
  if (Math.abs(linearFactor - 1) < 0.001) {
    return analysis;
  }
  // Sanity clamp: a correction larger than 2× (or smaller than 0.5×) is
  // implausibly big — almost always a mm/m unit mismatch or the wrong
  // dimension type. Don't apply it; leave the takeoff as the model produced it.
  if (linearFactor < 0.5 || linearFactor > 2.0) {
    return analysis;
  }

  const areaFactor = linearFactor * linearFactor;
  const next: FloorplanAnalysis = { ...analysis };

  if (typeof next.totalAreaM2 === 'number') {
    next.totalAreaM2 = next.totalAreaM2 * areaFactor;
  }
  if (typeof next.removalAreaM2 === 'number') {
    next.removalAreaM2 = next.removalAreaM2 * areaFactor;
  }
  // The footprint grows by area, but skip depth is fixed → volume scales by
  // the area factor, not the cube.
  if (typeof next.removalBinM3 === 'number') {
    next.removalBinM3 = next.removalBinM3 * areaFactor;
  }
  if (typeof next.perimeterM === 'number') {
    next.perimeterM = next.perimeterM * linearFactor;
  }
  if (Array.isArray(next.zones)) {
    next.zones = next.zones.map((z) => {
      const zone: FloorplanZone = { ...z };
      if (typeof zone.areaM2 === 'number') zone.areaM2 = zone.areaM2 * areaFactor;
      if (typeof zone.removalAreaM2 === 'number') {
        zone.removalAreaM2 = zone.removalAreaM2 * areaFactor;
      }
      if (zone.dims) {
        zone.dims = {
          lengthM: zone.dims.lengthM * linearFactor,
          widthM: zone.dims.widthM * linearFactor,
        };
      }
      return zone;
    });
  }

  next.scaledToAnchor = true;
  next.scaleFactorApplied = linearFactor;
  next.source = 'model';

  // Anchoring onto a real-world measurement is a meaningful confidence boost —
  // never downgrade an already-confident read.
  if (next.confidence !== 'medium' && next.confidence !== 'high') {
    next.confidence = 'medium';
  }

  const note = `Measurements scaled to match the stated dimension (×${linearFactor.toFixed(3)}).`;
  next.assumptions = next.assumptions ? `${next.assumptions} ${note}` : note;

  return next;
}
