/**
 * Structural integrity checks for a saved Quote/Invoice document.
 *
 * Purpose: take a Firestore document as-is and surface every internal
 * inconsistency a future fix or audit script should know about. Pure
 * functions — no IO, no SDK deps — so they run inside vitest and
 * inside the audit script (`functions/scripts/auditRecentQuotes.ts`)
 * identically.
 *
 * Bug shapes this covers, each one seen in production:
 *   - section_total_mismatch:   section.laborTotal != laborHours × laborRate × multiplier
 *                               (QU-177866 — multiplier dropped from labour calc)
 *   - section_zero_labour:      section exists with 0h and $0  (QU-177963 paving job)
 *   - labour_total_mismatch:    doc.laborTotal != Σ section totals + extra
 *   - subtotal_mismatch:        doc.subtotal != materialsSubtotal + laborTotal
 *   - materials_subtotal_mismatch: stored value drifts from Σ material.totalPrice
 *   - markup_amount_mismatch:   stored markupAmount doesn't match independent material/labour rates
 *   - total_mismatch:           grand total doesn't match the chosen GST mode
 *   - piece_good_bad_unit:      pavers/tiles/decking-boards/etc with unit m²/m³
 *                               (delegates to validateAndRepairAiOutput)
 *   - zero_priced_material:     material with price=0 and quantity>0
 *   - estimated_hours_drift:    JobSpec.estimatedHours diverges from section sum
 *                               (becomes a non-issue after updateDocumentCalculations runs)
 */

import { validateAndRepairAiOutput } from '../ai/validateAiOutput';

const STANDARD_DAY_HOURS = 8;
const DEFAULT_DOLLAR_TOLERANCE = 0.5;
const ESTIMATED_HOURS_DRIFT_TOLERANCE_H = 2;

export interface IntegrityIssue {
  code: IntegrityCode;
  detail: string;
  expected?: number;
  actual?: number;
  diff?: number;
}

export type IntegrityCode =
  | 'materials_subtotal_mismatch'
  | 'section_total_mismatch'
  | 'section_zero_labour'
  | 'labour_total_mismatch'
  | 'subtotal_mismatch'
  | 'markup_amount_mismatch'
  | 'total_mismatch'
  | 'piece_good_bad_unit'
  | 'zero_priced_material'
  | 'estimated_hours_drift';

export interface IntegrityCheckOptions {
  dollarTolerance?: number;
  estimatedHoursDriftToleranceH?: number;
}

interface DocLike {
  type?: string;
  stage?: string;
  laborRate?: number;
  laborHours?: number;
  laborUnit?: 'hours' | 'days';
  laborTotal?: number;
  laborExtraHours?: number;
  laborMarkup?: number;
  markup?: number;
  travelAdjustment?: number;
  materialsSubtotal?: number;
  subtotal?: number;
  markupAmount?: number;
  gst?: number;
  total?: number;
  pricesIncludeGst?: boolean;
  materials?: any[];
  sections?: any[];
  job?: { estimatedHours?: number };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nearlyEqual(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

export function checkDocumentIntegrity(d: DocLike, opts: IntegrityCheckOptions = {}): IntegrityIssue[] {
  const tol = opts.dollarTolerance ?? DEFAULT_DOLLAR_TOLERANCE;
  const hoursTol = opts.estimatedHoursDriftToleranceH ?? ESTIMATED_HOURS_DRIFT_TOLERANCE_H;
  const issues: IntegrityIssue[] = [];

  const materials = Array.isArray(d.materials) ? d.materials : [];
  const sections = Array.isArray(d.sections) ? d.sections : [];

  // 1. materialsSubtotal = Σ(material.totalPrice)
  const matSum = round2(materials.reduce((s, m: any) => s + (Number(m.totalPrice) || 0), 0));
  if (typeof d.materialsSubtotal === 'number' && !nearlyEqual(matSum, d.materialsSubtotal, tol)) {
    issues.push({
      code: 'materials_subtotal_mismatch',
      detail: `stored materialsSubtotal=${d.materialsSubtotal}, recomputed=${matSum}`,
      expected: matSum, actual: d.materialsSubtotal, diff: round2(d.materialsSubtotal - matSum),
    });
  }

  // 2. Per-section: laborTotal = laborHours × laborRate × multiplier
  //    (QU-177866 — multiplier dropped from labour calc)
  for (const s of sections as any[]) {
    const expected = round2((Number(s.laborHours) || 0) * (Number(s.laborRate) || 0) * (Number(s.multiplier) || 1));
    const actual = Number(s.laborTotal) || 0;
    if (!nearlyEqual(expected, actual, tol)) {
      issues.push({
        code: 'section_total_mismatch',
        detail: `section "${s.name || s.id || '?'}" laborTotal=${actual}, expected ${expected} from ${s.laborHours} × ${s.laborRate} × ${s.multiplier}`,
        expected, actual, diff: round2(actual - expected),
      });
    }
  }

  // 3. Section with 0 hours and 0 dollars (QU-177963 paving job)
  for (const s of sections as any[]) {
    const hrs = Number(s.laborHours) || 0;
    const tot = Number(s.laborTotal) || 0;
    if (tot === 0 && hrs === 0) {
      issues.push({
        code: 'section_zero_labour',
        detail: `section "${s.name || s.id}" has no hours and $0 labour`,
      });
    }
  }

  // 4. laborTotal = Σ(section.laborTotal) + extra × rate  (or laborHours × rate without sections)
  const rate = Number(d.laborRate) || 0;
  const extra = Number(d.laborExtraHours) || 0;
  const expectedLabour = sections.length > 0
    ? round2(sections.reduce((s, x: any) => s + (Number(x.laborTotal) || 0), 0) + extra * rate)
    : round2((Number(d.laborHours) || 0) * rate);
  if (typeof d.laborTotal === 'number' && !nearlyEqual(expectedLabour, d.laborTotal, tol)) {
    issues.push({
      code: 'labour_total_mismatch',
      detail: `stored laborTotal=${d.laborTotal}, recomputed=${expectedLabour}`,
      expected: expectedLabour, actual: d.laborTotal, diff: round2(d.laborTotal - expectedLabour),
    });
  }

  // 5. subtotal = materialsSubtotal + laborTotal
  if (typeof d.subtotal === 'number') {
    const expectedSub = round2((d.materialsSubtotal || 0) + (d.laborTotal || 0));
    if (!nearlyEqual(expectedSub, d.subtotal, tol)) {
      issues.push({
        code: 'subtotal_mismatch',
        detail: `stored subtotal=${d.subtotal}, recomputed=${expectedSub}`,
        expected: expectedSub, actual: d.subtotal, diff: round2(d.subtotal - expectedSub),
      });
    }
  }

  // 6. Markup = materials × markupPct + labour × laborMarkupPct
  if (typeof d.markupAmount === 'number') {
    const matMarkupPct = Number(d.markup) || 0;
    const labMarkupPct = Number(d.laborMarkup ?? d.markup ?? 0);
    const expectedMarkup = round2(
      (d.materialsSubtotal || 0) * (matMarkupPct / 100) +
      (d.laborTotal || 0) * (labMarkupPct / 100)
    );
    if (!nearlyEqual(expectedMarkup, d.markupAmount, tol)) {
      issues.push({
        code: 'markup_amount_mismatch',
        detail: `stored markupAmount=${d.markupAmount}, recomputed=${expectedMarkup} (mat ${matMarkupPct}% + lab ${labMarkupPct}%)`,
        expected: expectedMarkup, actual: d.markupAmount, diff: round2(d.markupAmount - expectedMarkup),
      });
    }
  }

  // 7. Total under inclusive/exclusive GST mode
  if (typeof d.total === 'number') {
    const sub = Number(d.subtotal) || 0;
    const markup = Number(d.markupAmount) || 0;
    const travel = (Number(d.travelAdjustment) || 0) / 100 * sub;
    const subWithMarkup = sub + markup + travel;
    const expectedTotal = d.pricesIncludeGst ? round2(subWithMarkup) : round2(subWithMarkup * 1.1);
    if (!nearlyEqual(expectedTotal, d.total, tol)) {
      issues.push({
        code: 'total_mismatch',
        detail: `stored total=${d.total}, recomputed=${expectedTotal} (pricesIncludeGst=${!!d.pricesIncludeGst})`,
        expected: expectedTotal, actual: d.total, diff: round2(d.total - expectedTotal),
      });
    }
  }

  // 8. AI-validator hits (piece-good units, zero-priced materials)
  const flatMaterials = materials.map((m: any) => ({
    name: m.name, unit: m.unit, quantity: m.quantity, price: m.price,
  }));
  const { flags } = validateAndRepairAiOutput(flatMaterials, { warn: () => {} });
  if (flags.hasInvalidUnit) {
    issues.push({
      code: 'piece_good_bad_unit',
      detail: `${flags.invalidUnitCount} piece-good(s) with area/volume units`,
    });
  }
  if (flags.hasZeroPricedMaterial) {
    issues.push({
      code: 'zero_priced_material',
      detail: `${flags.zeroPricedMaterialCount} material(s) at $0 with positive qty`,
    });
  }

  // 9. JobSpec.estimatedHours drift vs section labour
  if (sections.length > 0 && typeof d.job?.estimatedHours === 'number') {
    const sectionHours = sections.reduce((sum, s: any) => {
      const total = typeof s.laborHoursTotal === 'number'
        ? s.laborHoursTotal
        : (Number(s.laborHours) || 0) * (Number(s.multiplier) || 1);
      return sum + (s.laborUnit === 'days' ? total * STANDARD_DAY_HOURS : total);
    }, 0);
    const extraHours = d.laborUnit === 'days' ? extra * STANDARD_DAY_HOURS : extra;
    const expected = Math.round(sectionHours + extraHours);
    const drift = Math.abs(d.job.estimatedHours - expected);
    if (drift >= hoursTol) {
      issues.push({
        code: 'estimated_hours_drift',
        detail: `JobSpec.estimatedHours=${d.job.estimatedHours} but section sum=${expected} (drift ${drift}h)`,
        expected, actual: d.job.estimatedHours, diff: d.job.estimatedHours - expected,
      });
    }
  }

  return issues;
}
