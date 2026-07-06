/**
 * Oracle post-processing for the replay audit.
 *
 * The oracle LLM is asked for a fixed gap-kind enum, but preview models stray
 * ("product-match", "product_selection", "quantity_overestimation", …), which
 * makes run-over-run category trends impossible to compare. normalizeGapKind
 * maps any variant onto the canonical enum deterministically.
 *
 * replayDeterministicIssues + capVerdict keep the oracle honest: a replay
 * that still contains $0 rows or one line dominating the whole subtotal can
 * never be graded "pass", whatever the LLM thinks.
 */

export const GAP_KINDS = [
  'product_match',
  'quantity',
  'unit_conversion',
  'pack_conversion',
  'pricing',
  'fallback_estimate',
  'missing_material',
  'material_generation',
  'labour',
  'other',
] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export function normalizeGapKind(raw: unknown): GapKind {
  const k = String(raw || '').toLowerCase().replace(/[-\s]+/g, '_');
  if ((GAP_KINDS as readonly string[]).includes(k)) return k as GapKind;
  if (k.includes('fallback')) return 'fallback_estimate';
  if (k.includes('product')) return 'product_match';
  if (k.includes('pack')) return 'pack_conversion';
  if (k.includes('unit')) return 'unit_conversion';
  if (k.includes('quantity') || k.includes('count')) return 'quantity';
  if (k.includes('labour') || k.includes('labor') || k.includes('hours')) return 'labour';
  if (k.includes('missing') || k.includes('addition')) return 'missing_material';
  if (k.includes('material') || k.includes('generation') || k.includes('breakdown')) return 'material_generation';
  if (k.includes('pric') || k.includes('estimat') || k.includes('cost')) return 'pricing';
  return 'other';
}

export interface ReplayIssue {
  code: string;
  detail: string;
}

interface ReplayLike {
  materialsSubtotal?: number;
  materials?: Array<{ name?: string; quantity?: number; price?: number; totalPrice?: number; priceStatus?: string }>;
}

// A single consumable line soaking up most of the subtotal is the signature
// of a unit/pack conversion blow-out ($5,250 of paper joint tape), not a real
// bill of materials. Big-ticket single items exist, so only flag lines that
// dominate AND the quote is large enough for dominance to be surprising.
const DOMINANCE_SHARE = 0.6;
const DOMINANCE_MIN_SUBTOTAL = 800;

export function replayDeterministicIssues(replay: ReplayLike): ReplayIssue[] {
  const issues: ReplayIssue[] = [];
  const materials = replay.materials || [];
  const zeroPriced = materials.filter((m) => (m.quantity || 0) > 0 && !((m.price || 0) > 0));
  if (zeroPriced.length > 0) {
    issues.push({
      code: 'zero_priced_replay_material',
      detail: `${zeroPriced.length} replay material(s) at $0 with positive qty: ${zeroPriced.slice(0, 5).map((m) => m.name).join(', ')}`,
    });
  }
  const subtotal = replay.materialsSubtotal || 0;
  if (subtotal >= DOMINANCE_MIN_SUBTOTAL) {
    for (const m of materials) {
      const line = m.totalPrice || 0;
      if (line / subtotal >= DOMINANCE_SHARE) {
        issues.push({
          code: 'dominant_line_total',
          detail: `"${m.name}" is $${line} of a $${subtotal} subtotal (${Math.round((line / subtotal) * 100)}%) — likely unit/pack conversion blow-out`,
        });
      }
    }
  }
  return issues;
}

/**
 * Deterministic issues cap the oracle's verdict at "review" — the original
 * verdict is preserved on rawVerdict so capped runs are distinguishable.
 */
export function capVerdict(oracle: { verdict?: string; rawVerdict?: string }, issues: ReplayIssue[]): void {
  if (issues.length > 0 && oracle.verdict === 'pass') {
    oracle.rawVerdict = oracle.verdict;
    oracle.verdict = 'review';
  }
}
