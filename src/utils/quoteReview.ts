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

import { Material } from '../types';

export type QuoteIssueKind = 'unpriced' | 'estimated' | 'low_confidence';

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
  if (counts.unpriced) parts.push(`${counts.unpriced} with no price`);
  if (counts.estimated) parts.push(`${counts.estimated} estimated`);
  if (counts.lowConfidence) parts.push(`${counts.lowConfidence} low-confidence`);

  const names = issues.slice(0, 3).map((i) => i.name);
  const more = issues.length > names.length ? `, +${issues.length - names.length} more` : '';
  const noun = issues.length === 1 ? 'row' : 'rows';
  return `${issues.length} ${noun} need a look — ${parts.join(', ')}. (${names.join(', ')}${more})`;
}

/**
 * Scan a quote's materials and report the rows the pipeline already flagged.
 * Deterministic — no network, no model, safe to call after every pricing pass.
 */
export function reviewQuoteMaterials(materials: Material[] | undefined | null): QuoteReview {
  const issues: QuoteIssue[] = [];
  for (const m of materials ?? []) {
    const kind = classifyRow(m);
    if (!kind) continue;
    issues.push({
      materialId: m.id,
      name: m.name,
      kind,
      detail: m.description?.trim() || DEFAULT_DETAIL[kind],
      price: m.price,
      quantity: m.quantity,
      unit: m.unit,
    });
  }

  const counts = {
    unpriced: issues.filter((i) => i.kind === 'unpriced').length,
    estimated: issues.filter((i) => i.kind === 'estimated').length,
    lowConfidence: issues.filter((i) => i.kind === 'low_confidence').length,
    total: issues.length,
  };

  return { issues, counts, summary: buildSummary(issues, counts) };
}

export interface PresendWarning {
  title: string;
  message: string;
}

/**
 * Pre-send gate message: built ONLY when the document still contains $0 rows
 * — those print as $0 line items on the customer's copy. Estimated /
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
  if (unpriced.length === 0) return null;

  const visible = options.materialsShownToCustomer !== false;
  const consequence = visible
    ? `will show as $0 on the customer's ${docLabel}`
    : `${unpriced.length === 1 ? "isn't" : "aren't"} counted in the ${docLabel} total`;
  const shown = unpriced.slice(0, 3).map((i) => `• ${i.name}`);
  const more = unpriced.length - shown.length;
  const lines = [
    `${unpriced.length} item${unpriced.length === 1 ? ' has' : 's have'} no price and ${consequence}:`,
    ...shown,
    ...(more > 0 ? [`(+${more} more)`] : []),
  ];
  const estimated = review.counts.estimated + review.counts.lowConfidence;
  if (estimated > 0) {
    lines.push('', `${estimated} more ${estimated === 1 ? 'is an estimate' : 'are estimates'} — worth a quick check too.`);
  }
  return { title: 'Some prices need a look', message: lines.join('\n') };
}
