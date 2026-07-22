/**
 * quoteReview — deterministic read of the pricing pipeline's per-row verdicts.
 *
 * The materials pipeline's reconcile pass (materialsPipeline.ts) already decides
 * which rows are dodgy and stamps that verdict onto each Material:
 *   - a rejected / unmatched product   → price = 0, priceConfidence = 'low'
 *   - an AI estimate (no real shelf $)  → price > 0, priceConfidence = 'low', pricingSource = 'ai'
 *   - a confident match                 → price > 0, priceConfidence 'medium' | 'high'
 * plus a human-readable `description` ("Product mismatch — verify before sending",
 * "Estimated — verify with supplier", coverage notes).
 *
 * This module does NOT re-derive any pricing judgement — it only reads those
 * existing flags and turns them into a compact issue list + a one-line summary.
 * It is the single source of truth for two callers:
 *   1. Mate's `review_quote` read tool — surfaces issues on request.
 *   2. `applyProposal` — surfaces issues proactively after a draft/reprice, and
 *      decides which rows `propose_reprice` should reset and re-fetch.
 *
 * Manual price overrides are always left alone: the tradie set those on purpose.
 */

import { Material, QuoteSection } from '../types';

export type QuoteIssueKind = 'unpriced' | 'estimated' | 'low_confidence' | 'inflated_quantity';

export interface QuoteIssue {
  materialId: string;
  name: string;
  kind: QuoteIssueKind;
  /** Short, tradie-readable reason — the row's own description when it has one. */
  detail: string;
  price: number;
  quantity: number;
  unit: string;
}

export interface QuoteReview {
  issues: QuoteIssue[];
  counts: {
    unpriced: number;
    estimated: number;
    lowConfidence: number;
    /** Quantities laundered from a job area anchor (see detectAnchorLaunderedIssues). */
    inflatedQuantity: number;
    /** Total flagged rows — equals issues.length. */
    total: number;
  };
  /** Plain-English line Mate can read verbatim, in chat or aloud. */
  summary: string;
}

const DEFAULT_DETAIL: Record<QuoteIssueKind, string> = {
  unpriced: 'No price yet — needs a product match.',
  estimated: 'Estimated price, not a real supplier quote — verify before sending.',
  low_confidence: 'Low-confidence price — worth a quick check.',
  inflated_quantity: 'Quantity looks scaled from the job size, not real coverage — verify before sending.',
};

/**
 * Classify a single row, or null when it's fine / deliberately set by the tradie.
 * A manual override is never an issue — it's the tradie's own number.
 */
function classifyRow(m: Material): QuoteIssueKind | null {
  if (m.manualPriceOverride) return null;
  if (!(m.price > 0)) return 'unpriced';
  if (m.priceConfidence === 'low') {
    return m.pricingSource === 'ai' ? 'estimated' : 'low_confidence';
  }
  return null;
}

/**
 * Whether a row is flagged — i.e. `propose_reprice` should reset and re-fetch it.
 * Mirrors classifyRow so "what gets surfaced" and "what gets re-priced" never drift.
 */
export function isFlaggedRow(m: Material): boolean {
  return classifyRow(m) !== null;
}

function buildSummary(issues: QuoteIssue[], counts: QuoteReview['counts']): string {
  if (issues.length === 0) return 'All good — every line came back with a real price.';

  const parts: string[] = [];
  if (counts.inflatedQuantity) parts.push(`${counts.inflatedQuantity} with an inflated quantity`);
  if (counts.unpriced) parts.push(`${counts.unpriced} with no price`);
  if (counts.estimated) parts.push(`${counts.estimated} estimated`);
  if (counts.lowConfidence) parts.push(`${counts.lowConfidence} low-confidence`);

  const names = issues.slice(0, 3).map((i) => i.name);
  const more = issues.length > names.length ? `, +${issues.length - names.length} more` : '';
  const noun = issues.length === 1 ? 'row' : 'rows';
  return `${issues.length} ${noun} need a look — ${parts.join(', ')}. (${names.join(', ')}${more})`;
}

// --- Anchor-launder detection (QU-178425) ---------------------------------
//
// Round-1 generation classifies a job into sections. A "per-m² surface-covering"
// section carries the job area as its multiplier and hours-PER-m² as its labour
// rate; each material is meant to hold a real per-m² density (6.25 pavers/m²,
// ~160 kg sand/m²) that × area gives the total. The failure mode: the model
// mis-classifies a job as per-m² but derives NOTHING — it emits "1 per m²" for
// every material, so × area launders the raw job size onto each line (a 165 m²
// re-roof → 165 sheets, 165 silicone tubes, 495 screws). The reconcile pass
// then divides by real pack sizes where it can, so some lines end up plausible
// and the wrong ones hide inside a plausible-looking total.
//
// This detector keys on the fingerprint that survives to the stored quote: a
// per-m² section in which not one material carries a real density. Deterministic.

// A per-m² / area-scaled section carries a fractional hours-PER-UNIT rate (e.g.
// 0.5 h/m²) over a large multiplier that is really an area. Discrete-unit
// sections (fence bays, gates) carry >= 1 h per unit and small counts, so this
// never trips on them.
const AREA_SECTION_MAX_HOURS = 1;        // hours-per-unit below 1 => a per-m² rate
const AREA_SECTION_MIN_MULTIPLIER = 20;  // an area big enough that "1 per m²" is absurd
// A per-unit quantity this small in a per-m² section is an un-derived stand-in.
// A genuine per-m² section always has at least one substantial density.
const PLACEHOLDER_PER_UNIT_MAX = 3;

/** Per-unit quantity Round-1 emitted before × multiplier. Prefers the stored
 *  templateBaseQuantity; falls back to quantity ÷ multiplier for older rows. */
function perUnitQuantity(m: Material, multiplier: number): number {
  if (typeof m.templateBaseQuantity === 'number' && m.templateBaseQuantity > 0) {
    return m.templateBaseQuantity;
  }
  return multiplier > 0 ? m.quantity / multiplier : m.quantity;
}

/** A row still showing the raw area anchor: its buy-qty equals the area, its
 *  underlying requirement equals the area, or its buy-qty is a small integer
 *  multiple of the area (495 = 3 × 165). These are the laundered lines. */
function showsAreaAnchor(m: Material, multiplier: number): boolean {
  if (multiplier <= 0) return false;
  if (m.quantity === multiplier) return true;
  if (m.requiredQty === multiplier) return true;
  return m.quantity % multiplier === 0 && m.quantity / multiplier <= PLACEHOLDER_PER_UNIT_MAX;
}

/**
 * Detect sections where Round-1 laundered the job's area anchor into every
 * material quantity instead of deriving real coverage. Returns one issue per
 * anchor-showing row in a laundered section. Deterministic — no model.
 */
export function detectAnchorLaunderedIssues(
  materials: Material[] | undefined | null,
  sections: QuoteSection[] | undefined | null,
): QuoteIssue[] {
  if (!materials?.length || !sections?.length) return [];
  const issues: QuoteIssue[] = [];
  for (const s of sections) {
    const multiplier = s.multiplier;
    const areaScaled =
      s.laborHours > 0 &&
      s.laborHours < AREA_SECTION_MAX_HOURS &&
      multiplier >= AREA_SECTION_MIN_MULTIPLIER;
    if (!areaScaled) continue;

    const mats = materials.filter((m) => m.section === s.name);
    if (mats.length < 3) continue;

    // Laundered iff NOT ONE material carries a real per-m² density — every
    // per-unit quantity is a trivial placeholder. A genuine per-m² section
    // (tiling, paving, screeding) always has at least one substantial density.
    const everyPlaceholder = mats.every((m) => perUnitQuantity(m, multiplier) <= PLACEHOLDER_PER_UNIT_MAX);
    if (!everyPlaceholder) continue;

    for (const m of mats) {
      if (!showsAreaAnchor(m, multiplier)) continue;
      issues.push({
        materialId: m.id,
        name: m.name,
        kind: 'inflated_quantity',
        detail: `Quantity looks scaled from the ${multiplier} m² job size, not real coverage — every line in “${s.name}” was multiplied by the area. Verify before sending.`,
        price: m.price,
        quantity: m.quantity,
        unit: m.unit,
      });
    }
  }
  return issues;
}

/**
 * Scan a quote's materials and report the rows the pipeline already flagged.
 * Deterministic — no network, no model, safe to call after every pricing pass.
 * Pass `sections` to also catch area-anchor-laundered quantities (QU-178425).
 */
export function reviewQuoteMaterials(
  materials: Material[] | undefined | null,
  sections?: QuoteSection[] | null,
): QuoteReview {
  const rowIssues: QuoteIssue[] = [];
  for (const m of materials ?? []) {
    const kind = classifyRow(m);
    if (!kind) continue;
    rowIssues.push({
      materialId: m.id,
      name: m.name,
      kind,
      detail: m.description?.trim() || DEFAULT_DETAIL[kind],
      price: m.price,
      quantity: m.quantity,
      unit: m.unit,
    });
  }

  // Inflated-quantity is the more actionable verdict, so it leads and wins the
  // dedupe: a laundered row is almost always also low-confidence priced, and we
  // don't want to list the same material twice.
  const inflated = detectAnchorLaunderedIssues(materials, sections);
  const inflatedIds = new Set(inflated.map((i) => i.materialId));
  const issues = [...inflated, ...rowIssues.filter((i) => !inflatedIds.has(i.materialId))];

  const counts = {
    unpriced: issues.filter((i) => i.kind === 'unpriced').length,
    estimated: issues.filter((i) => i.kind === 'estimated').length,
    lowConfidence: issues.filter((i) => i.kind === 'low_confidence').length,
    inflatedQuantity: issues.filter((i) => i.kind === 'inflated_quantity').length,
    total: issues.length,
  };

  return { issues, counts, summary: buildSummary(issues, counts) };
}

export interface PresendWarning {
  title: string;
  message: string;
}

/**
 * Pre-send gate message: built when the document still contains $0 rows (they
 * print as $0 line items on the customer's copy) OR area-anchor-laundered
 * quantities (an absurd count like "165 silicone tubes" is a trust-killer on
 * the customer copy — see detectAnchorLaunderedIssues). Estimated /
 * low-confidence rows alone don't gate the send (they're priced and flagged
 * in the list already; warning on every estimate would teach tradies to
 * dismiss the dialog without reading it).
 */
export function buildPresendWarning(
  review: QuoteReview,
  docLabel: 'quote' | 'invoice' = 'quote',
  options: {
    /** false when the doc hides material line items from the customer
     *  (showMaterialCosts off) — the $0 rows aren't visible then, but the
     *  total is still missing their money, so the gate still fires with
     *  wording that matches the real consequence. */
    materialsShownToCustomer?: boolean;
  } = {},
): PresendWarning | null {
  const unpriced = review.issues.filter((i) => i.kind === 'unpriced');
  const inflated = review.issues.filter((i) => i.kind === 'inflated_quantity');
  if (unpriced.length === 0 && inflated.length === 0) return null;

  const lines: string[] = [];

  if (unpriced.length > 0) {
    const visible = options.materialsShownToCustomer !== false;
    const consequence = visible
      ? `will show as $0 on the customer's ${docLabel}`
      : `${unpriced.length === 1 ? "isn't" : "aren't"} counted in the ${docLabel} total`;
    const shown = unpriced.slice(0, 3).map((i) => `• ${i.name}`);
    const more = unpriced.length - shown.length;
    lines.push(
      `${unpriced.length} item${unpriced.length === 1 ? ' has' : 's have'} no price and ${consequence}:`,
      ...shown,
      ...(more > 0 ? [`(+${more} more)`] : []),
    );
  }

  if (inflated.length > 0) {
    if (lines.length > 0) lines.push('');
    const shown = inflated.slice(0, 3).map((i) => `• ${i.name} (${i.quantity} ${i.unit})`);
    const more = inflated.length - shown.length;
    lines.push(
      `${inflated.length} ${inflated.length === 1 ? "item's quantity looks" : "items' quantities look"} scaled from the job size, not real coverage — check ${inflated.length === 1 ? 'it' : 'them'} before sending:`,
      ...shown,
      ...(more > 0 ? [`(+${more} more)`] : []),
    );
  }

  // Estimate tail only alongside unpriced rows (unchanged behaviour) — warning
  // on every estimate would train tradies to dismiss the dialog unread.
  if (unpriced.length > 0) {
    const estimated = review.counts.estimated + review.counts.lowConfidence;
    if (estimated > 0) {
      lines.push('', `${estimated} more ${estimated === 1 ? 'is an estimate' : 'are estimates'} — worth a quick check too.`);
    }
  }

  const title =
    unpriced.length > 0 && inflated.length > 0
      ? 'Some prices and quantities need a look'
      : inflated.length > 0
        ? 'Some quantities need a look'
        : 'Some prices need a look';

  return { title, message: lines.join('\n') };
}
