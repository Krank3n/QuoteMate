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
  // dimension type. Don't apply it; leave the takeoff as the model produced it,
  // but leave a breadcrumb so a genuinely-needed big correction isn't invisible.
  if (linearFactor < 0.5 || linearFactor > 2.0) {
    const note = `Stated dimension implied a ×${linearFactor.toFixed(2)} correction — left as measured (check the plan scale / units).`;
    return {
      ...analysis,
      assumptions: analysis.assumptions ? `${analysis.assumptions} ${note}` : note,
    };
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

// ---------------------------------------------------------------------------
// Material-quantity anchoring (Phase 3)
//
// applyAnchorScale fixes the *takeoff* numbers, but the LLM already grounded
// every material quantity on its own un-anchored areas — so without this the
// visible card (corrected) and the line items (un-corrected) silently disagree.
// Here we push the SAME anchor correction through the materials so the quote is
// actually priced on the real-world geometry.
//
// The catch: the geometry can live in either field. Per the materials prompt,
// per-area surface sections carry the area in `sectionMultiplier` (m²) with
// per-m² `quantity`; fixed sections carry the count in `quantity` with
// `sectionMultiplier = 1`. Scaling the wrong field would corrupt the quote, so
// we only act on materials the model explicitly tagged with a geometry
// `planBasis`, and we scale whichever field actually holds the geometry:
//   - sectionMultiplier > 1  → the multiplier is the geometry (m² or unit count)
//   - sectionMultiplier <= 1 → the geometry is baked into the per-unit quantity
// Untagged materials (and `planBasis: 'fixed'`) are left exactly as the model
// produced them — no silent rewrites, no regression.
// ---------------------------------------------------------------------------

export type PlanBasis = 'area' | 'perimeter' | 'volume' | 'fixed';

interface ScalableMaterial {
  quantity?: number;
  requiredQty?: number;
  sectionMultiplier?: number;
  unit?: string;
  planBasis?: string;
  reasoning?: string;
  [key: string]: unknown;
}

function basisFactor(basis: PlanBasis, linearFactor: number): number {
  switch (basis) {
    case 'area':
      return linearFactor * linearFactor;
    case 'volume':
      // Floor-related volume is area × a fixed depth, so it tracks the area
      // factor (not the cube) — same convention as removalBinM3 above.
      return linearFactor * linearFactor;
    case 'perimeter':
      return linearFactor;
    case 'fixed':
    default:
      return 1;
  }
}

/**
 * Scale every geometry-tagged material by the anchor's linear factor so the
 * priced quantities match the corrected takeoff. Pure + side-effect free.
 * Returns the list unchanged when there's no meaningful correction.
 */
export function scaleMaterialsToAnchor<T extends ScalableMaterial>(
  materials: T[],
  linearFactor: number | undefined,
): T[] {
  if (
    !Array.isArray(materials) ||
    typeof linearFactor !== 'number' ||
    !isFinite(linearFactor) ||
    linearFactor <= 0 ||
    Math.abs(linearFactor - 1) < 0.001
  ) {
    return materials;
  }

  return materials.map((m) => {
    const raw = (m.planBasis || '').toString().toLowerCase();
    // Only act on an explicit geometry basis. No tag → leave it alone.
    if (raw !== 'area' && raw !== 'perimeter' && raw !== 'volume') {
      return m;
    }
    const factor = basisFactor(raw as PlanBasis, linearFactor);
    if (factor === 1) return m;

    const round = (n: number) => Math.round(n * factor * 1000) / 1000;
    const next: T = { ...m };
    const mult = typeof m.sectionMultiplier === 'number' ? m.sectionMultiplier : 1;

    if (mult > 1) {
      // Geometry is the multiplier (m² of surface, count of repeating units).
      (next as ScalableMaterial).sectionMultiplier = round(mult);
    } else {
      // Geometry baked into the per-unit quantity.
      if (typeof m.quantity === 'number') (next as ScalableMaterial).quantity = round(m.quantity);
      if (typeof m.requiredQty === 'number') {
        (next as ScalableMaterial).requiredQty = round(m.requiredQty);
      }
    }

    const note = `Quantity scaled ×${factor.toFixed(3)} to the plan's stated dimension.`;
    (next as ScalableMaterial).reasoning = m.reasoning ? `${m.reasoning} ${note}` : note;
    (next as ScalableMaterial).quantityScaledToAnchor = true;
    return next;
  });
}
