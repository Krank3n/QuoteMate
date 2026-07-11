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
  // Zone boundary length and total width of doorways/openings in it; the net
  // (perimeterM - openingsDeductionM) is the quotable skirting/coving run.
  perimeterM?: number;
  openingsDeductionM?: number;
  removalAreaM2?: number;
  dims?: { lengthM: number; widthM: number };
}

export interface FloorplanAnalysis {
  detected: boolean;
  scale?: string;
  calibration?: {
    source: 'scale_bar' | 'known_dimension' | 'stated_total';
    basisMm?: number;
    /**
     * Tradie-stated overall length echoed by the model REGARDLESS of how it
     * scaled the drawing. This is the anchor: the model measures the drawing
     * independently (scale bar / labelled dimension) and we reconcile its
     * measurement against this stated ground truth deterministically.
     */
    statedLengthMm?: number;
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
  // length the tradie supplied. Preferred carrier is `statedLengthMm`, which
  // the model echoes regardless of how it scaled the drawing — so the anchor
  // fires even when the drawing was measured off a scale bar or labelled
  // dimension. Legacy fallback: `basisMm` when the model calibrated FROM the
  // stated total (`source === 'stated_total'`). Only these two describe the
  // outer footprint — `basisMm` under `known_dimension` is a labelled
  // sub-footprint dimension (e.g. a single grid bay) and using it as the
  // footprint length would catastrophically mis-scale the whole takeoff.
  const isUsableMm = (v: unknown): v is number =>
    typeof v === 'number' && isFinite(v) && v > 0;
  let statedLengthM: number | undefined;
  if (isUsableMm(analysis.calibration?.statedLengthMm)) {
    statedLengthM = analysis.calibration!.statedLengthMm! / 1000;
  } else if (
    analysis.calibration?.source === 'stated_total' &&
    isUsableMm(analysis.calibration.basisMm)
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
      if (typeof zone.perimeterM === 'number') {
        zone.perimeterM = zone.perimeterM * linearFactor;
      }
      if (typeof zone.openingsDeductionM === 'number') {
        zone.openingsDeductionM = zone.openingsDeductionM * linearFactor;
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
// Blind re-measurement (anchor laundering fix)
//
// Live replays of a ground-truth plan showed the vision model "laundering" a
// tradie-stated total length: told the building is 49 m, it reports
// footprintDims.lengthM = 49 as its own measurement, so the anchor factor is
// 49/49 and applyAnchorScale is a no-op — while the width (and thus every
// area) stays an uncorrected guess. Prompt instructions alone did not stop
// this. The deterministic fix: when laundering is detected, re-measure the
// plan with a second vision call that receives ONLY the image (no job text),
// so it cannot copy the stated value, then merge that independent geometry
// back in and let applyAnchorScale reconcile it against the stated length.
// ---------------------------------------------------------------------------

/**
 * True when the model appears to have copied the stated length into its own
 * footprint measurement (within 2%), which makes the anchor a no-op. Only
 * meaningful when a stated length exists.
 */
export function isAnchorLaundered(analysis: FloorplanAnalysis): boolean {
  const statedMm = analysis.calibration?.statedLengthMm;
  const modelLengthM = analysis.footprintDims?.lengthM;
  if (
    typeof statedMm !== 'number' || !isFinite(statedMm) || statedMm <= 0 ||
    typeof modelLengthM !== 'number' || !isFinite(modelLengthM) || modelLengthM <= 0
  ) {
    return false;
  }
  return Math.abs(modelLengthM * 1000 - statedMm) / statedMm < 0.02;
}

/**
 * Replace the takeoff's geometry with the blind pass's independent
 * measurement, keeping the original's job-scoped fields (removal scope,
 * stated length echo). Returns the original unchanged when the blind
 * measurement is unusable or implausible — never regresses.
 */
export function mergeBlindTakeoff(
  original: FloorplanAnalysis,
  blind: FloorplanAnalysis | undefined | null,
): FloorplanAnalysis {
  const usableNum = (v: unknown): v is number =>
    typeof v === 'number' && isFinite(v) && v > 0;
  if (
    !blind ||
    blind.detected !== true ||
    !usableNum(blind.totalAreaM2) ||
    !usableNum(blind.footprintDims?.lengthM) ||
    !usableNum(blind.footprintDims?.widthM)
  ) {
    return original;
  }
  // A blind read wildly different from the first read (>4× either way) means
  // one of the two calls went off the rails — don't guess which; keep the
  // original so behaviour is no worse than before this pass existed.
  if (usableNum(original.totalAreaM2)) {
    const ratio = blind.totalAreaM2! / original.totalAreaM2!;
    if (ratio > 4 || ratio < 0.25) return original;
  }

  const areaRatio = usableNum(original.totalAreaM2)
    ? blind.totalAreaM2! / original.totalAreaM2!
    : undefined;
  const note =
    'Geometry re-measured from the drawing alone, independent of the job description.';

  return {
    ...original,
    scale: blind.scale ?? original.scale,
    calibration: blind.calibration
      ? {
          ...blind.calibration,
          // Carry the stated-length echo forward — it's the anchor.
          statedLengthMm: original.calibration?.statedLengthMm,
        }
      : original.calibration,
    footprintDims: blind.footprintDims,
    totalAreaM2: blind.totalAreaM2,
    perimeterM: usableNum(blind.perimeterM) ? blind.perimeterM : original.perimeterM,
    zones: Array.isArray(blind.zones) && blind.zones.length ? blind.zones : original.zones,
    // Removal is job-text scope the blind pass can't see — keep the original
    // estimate but rescale it onto the independently measured geometry.
    removalAreaM2:
      usableNum(original.removalAreaM2) && areaRatio !== undefined
        ? original.removalAreaM2! * areaRatio
        : original.removalAreaM2,
    removalBinM3:
      usableNum(original.removalBinM3) && areaRatio !== undefined
        ? original.removalBinM3! * areaRatio
        : original.removalBinM3,
    confidence: blind.confidence ?? original.confidence,
    assumptions: original.assumptions ? `${original.assumptions} ${note}` : note,
  };
}

/**
 * Linear factor that reconciles material quantities (grounded on the FIRST
 * pass's areas) with the final anchored takeoff. Falls back to the anchor's
 * own factor when either total is missing.
 */
export function materialAnchorFactor(
  originalTotalAreaM2: number | undefined,
  final: FloorplanAnalysis | undefined,
): number | undefined {
  if (!final) return undefined;
  if (
    typeof originalTotalAreaM2 === 'number' && isFinite(originalTotalAreaM2) && originalTotalAreaM2 > 0 &&
    typeof final.totalAreaM2 === 'number' && isFinite(final.totalAreaM2) && final.totalAreaM2 > 0
  ) {
    return Math.sqrt(final.totalAreaM2 / originalTotalAreaM2);
  }
  if (final.scaledToAnchor && typeof final.scaleFactorApplied === 'number') {
    return final.scaleFactorApplied;
  }
  return undefined;
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
