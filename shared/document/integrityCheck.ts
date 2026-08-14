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
 *   - mixed_labour_units:       sections disagree with each other, or with the
 *                               document, about hours vs days (QU-178621 — the
 *                               state the ×8 rate bug grew out of)
 *   - labour_rate_implausible:  effective $/hour is a multiple of the business's
 *                               own rate (QU-178558 went to a customer at 8×)
 */

import { validateAndRepairAiOutput } from '../ai/validateAiOutput';
import { rateToHourly } from './labourUnits';

const STANDARD_DAY_HOURS = 8;
const DEFAULT_DOLLAR_TOLERANCE = 0.5;
const ESTIMATED_HOURS_DRIFT_TOLERANCE_H = 2;
/**
 * How far above the business's configured hourly rate a document may bill
 * before we call it a bug rather than a decision. A tradie legitimately
 * charging 2× their default on a nasty job passes; the ×8 day-rate confusion
 * does not.
 */
const RATE_IMPLAUSIBLE_MULTIPLE = 3;

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
  | 'estimated_hours_drift'
  | 'mixed_labour_units'
  | 'labour_rate_implausible';

export interface IntegrityCheckOptions {
  dollarTolerance?: number;
  estimatedHoursDriftToleranceH?: number;
  /**
   * The business's configured hourly rate (businessSettings.defaultLaborRate).
   * Enables the labour_rate_implausible check — omit it and that check is
   * skipped, since there is nothing to compare against.
   */
  businessHourlyRate?: number;
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
  gstRegistered?: boolean;
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

  // 7. Total under the GST mode (not registered / inclusive / exclusive)
  if (typeof d.total === 'number') {
    const sub = Number(d.subtotal) || 0;
    const markup = Number(d.markupAmount) || 0;
    const travel = (Number(d.travelAdjustment) || 0) / 100 * sub;
    const subWithMarkup = sub + markup + travel;
    const notRegistered = d.gstRegistered === false;
    const expectedTotal = notRegistered || d.pricesIncludeGst
      ? round2(subWithMarkup)
      : round2(subWithMarkup * 1.1);
    if (!nearlyEqual(expectedTotal, d.total, tol)) {
      issues.push({
        code: 'total_mismatch',
        detail: `stored total=${d.total}, recomputed=${expectedTotal} (gstRegistered=${d.gstRegistered !== false}, pricesIncludeGst=${!!d.pricesIncludeGst})`,
        expected: expectedTotal, actual: d.total, diff: round2(d.total - expectedTotal),
      });
    }
    if (notRegistered && typeof d.gst === 'number' && Math.abs(d.gst) > tol) {
      issues.push({
        code: 'total_mismatch',
        detail: `gst=${d.gst} stored on a not-GST-registered document (expected 0)`,
        expected: 0, actual: d.gst, diff: round2(d.gst),
      });
    }
  }

  // 8. AI-validator hits (piece-good units, zero-priced materials)
  // `kind` rides along so the validator can tell a $0 lump-sum scope line
  // (legitimate) from a material the pipeline failed to price (a hole).
  const flatMaterials = materials.map((m: any) => ({
    name: m.name, unit: m.unit, quantity: m.quantity, price: m.price, kind: m.kind,
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

  // 10. One document, one unit. Stored labour is canonical hours; anything
  //     still in days, or disagreeing section-to-section, is the shape the
  //     ×8 rate bug grew out of (QU-178621) and must be normalised.
  const sectionUnits = new Set(
    (sections as any[])
      .filter((s) => (Number(s.laborHours) || 0) > 0 || (Number(s.laborRate) || 0) > 0)
      .map((s) => (s.laborUnit === 'days' ? 'days' : 'hours')),
  );
  const docUnit = d.laborUnit === 'days' ? 'days' : 'hours';
  if (sectionUnits.size > 1) {
    issues.push({
      code: 'mixed_labour_units',
      detail: `sections disagree on unit (${Array.from(sectionUnits).join(' + ')}) — labour must be stored in hours`,
    });
  } else if (sectionUnits.size === 1 && !sectionUnits.has(docUnit)) {
    issues.push({
      code: 'mixed_labour_units',
      detail: `document unit=${docUnit} but sections are ${Array.from(sectionUnits)[0]} — labour must be stored in hours`,
    });
  } else if (sectionUnits.size === 0 && docUnit === 'days') {
    issues.push({
      code: 'mixed_labour_units',
      detail: 'document labour stored in days — labour must be stored in hours',
    });
  }

  // 11. Effective hourly rate vs what the business actually charges. Every
  //     ×8/×64 document in the Aug 2026 audit passed checks 1-9 because a
  //     doubled rate is still internally consistent — this is the check that
  //     catches it before a customer does.
  const businessRate = Number(opts.businessHourlyRate) || 0;
  if (businessRate > 0) {
    const rateSection = (sections as any[]).find((s) => (Number(s.laborRate) || 0) > 0);
    const effective = rateSection
      ? rateToHourly(rateSection.laborRate, rateSection.laborUnit)
      : rateToHourly(d.laborRate, d.laborUnit);
    if (effective > businessRate * RATE_IMPLAUSIBLE_MULTIPLE) {
      issues.push({
        code: 'labour_rate_implausible',
        detail: `effective $${round2(effective)}/h is ${round2(effective / businessRate)}× the business rate of $${businessRate}/h`,
        expected: businessRate, actual: round2(effective), diff: round2(effective - businessRate),
      });
    }
  }

  return issues;
}
