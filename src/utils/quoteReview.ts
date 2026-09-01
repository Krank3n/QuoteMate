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

export type QuoteIssueKind =
  | 'unpriced'
  | 'estimated'
  | 'low_confidence'
  | 'inflated_quantity'
  | 'weak_match'
  | 'implausible_cost';

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
    /** Rows priced off a product that barely resembles the request. */
    weakMatch: number;
    /** Rows carrying money that can't be right for what they are (see
     *  detectImplausibleCostIssues). */
    implausibleCost: number;
    /** Total flagged rows — equals issues.length. */
    total: number;
  };
  /** Plain-English line Mate can read verbatim, in chat or aloud. */
  summary: string;
  /**
   * Arithmetic the document contradicts — a labour total that doesn't match its
   * own hours x rate, a subtotal that doesn't match its lines. Separate from
   * `issues`, which are all per-material.
   */
  integrity?: string[];
}

const DEFAULT_DETAIL: Record<QuoteIssueKind, string> = {
  unpriced: 'No price yet — needs a product match.',
  estimated: 'Estimated price, not a real supplier quote — verify before sending.',
  low_confidence: 'Low-confidence price — worth a quick check.',
  inflated_quantity: 'Quantity looks scaled from the job size, not real coverage — verify before sending.',
  weak_match: 'The product we priced barely matches this line — it may be the wrong item.',
  implausible_cost: 'This line carries money that looks wrong for what it is — check the price and quantity.',
};

/**
 * Classify a single row, or null when it's fine / deliberately set by the tradie.
 * A manual override is never an issue — it's the tradie's own number.
 */
function classifyRow(m: Material): QuoteIssueKind | null {
  // A work item is a lump-sum scope line, not a product. $0 is a legitimate
  // price for one ("General preparation — included"), so it must never be
  // flagged `unpriced` or reset by propose_reprice.
  if (m.kind === 'work') return null;
  if (m.manualPriceOverride) return null;
  if (!(m.price > 0)) return 'unpriced';
  // Ranked above the generic low-confidence bucket: an estimate is the right
  // price for the right product, this is a real price for what may be the
  // wrong product. QU-178711 shipped 30 chrome towel bars at $85 for a rebar
  // line — $2,550, 64% of the quote's materials — as a 'high' confidence
  // supplier price.
  if (m.weakProductMatch) return 'weak_match';
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
  if (counts.implausibleCost) parts.push(`${counts.implausibleCost} carrying money that can't be right`);
  if (counts.inflatedQuantity) parts.push(`${counts.inflatedQuantity} with an inflated quantity`);
  if (counts.weakMatch) parts.push(`${counts.weakMatch} possibly the wrong product`);
  if (counts.unpriced) parts.push(`${counts.unpriced} with no price`);
  if (counts.estimated) parts.push(`${counts.estimated} estimated`);
  if (counts.lowConfidence) parts.push(`${counts.lowConfidence} low-confidence`);

  // Name the money, not just the row. "Skip Bin Hire, Road Base" reads like
  // small change; "$2,386.50 of Paper Joint Tape" is a tradie opening the quote.
  // `issues` arrives sorted by line total, so these are the three worth the look.
  const names = issues.slice(0, 3).map((i) => `${money(issueMoney(i))} of ${i.name}`);
  const more = issues.length > names.length ? `, +${issues.length - names.length} more` : '';
  const noun = issues.length === 1 ? 'row needs' : 'rows need';
  return `${issues.length} ${noun} a look — ${parts.join(', ')}. (${names.join(', ')}${more})`;
}

/** What a flagged row is carrying — the number that decides if it matters. */
function issueMoney(i: QuoteIssue): number {
  return (i.price || 0) * (i.quantity || 0);
}

function money(n: number): string {
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

// --- Implausible-cost detection (QU-178763) --------------------------------
//
// The fabricated-total family the flag system was blind to: an 11 m² floor-
// tiling job priced $16,942.97, every row carrying a "real" high-confidence
// price. Two fingerprints survived to the stored quote, and review_quote told
// the tradie the number was legit — "not a pricing glitch, just genuinely that
// much tile" — because nothing below looked at the MONEY, only the match
// metadata. Deterministic, like the anchor-launder detector above.

// (a) Identical-unit-price pair: the tile AND its adhesive both priced at
// exactly $187.25 — one product's price stamped onto two different lines.
// Two different products landing on the same cent at a substantial price is
// vanishingly rare honestly, but common when a match went wrong. The share
// floor keeps two $3.40 post caps or two same-priced paint colours quiet.
const TWIN_PRICE_MIN = 75;
const TWIN_PRICE_MIN_COMBINED_SHARE = 0.4;

// (b) An AUXILIARY line (adhesive, grout, screws — the stuff that serves the
// main material) carrying the biggest money on the quote. $8,239 of tile
// adhesive against $2,060 of tiles; the $81k bathroom's 10,850 kg of
// adhesive was 92% of materials. The main material dominating is normal
// (Colorbond sheets ARE most of a fence) — the helper dominating never is.
const AUX_RE = /\b(adhesive|glue|grout|sealant|silicone|caulk|screws?|nails?|fixings?|fasteners?|tape|caps?|brackets?|cleaner|additive)\b/i;
const AUX_DOMINANT_MIN_TOTAL = 500;
const AUX_DOMINANT_MIN_SHARE = 0.35;

// (c) Per-m² spend cap on auxiliary lines when the section carries a real
// area: $749/m² of adhesive is not a price any product explains.
const AUX_PER_AREA_MIN_MULTIPLIER = 5;
const AUX_PER_AREA_MAX_DOLLARS = 80;

function lineTotal(m: Material): number {
  return (m.price || 0) * (m.quantity || 0);
}

/** Rows eligible for money-sanity checks: real products the pipeline priced.
 *  Manual overrides are the tradie's own numbers; work items are lump sums. */
function costCheckable(m: Material): boolean {
  return m.kind !== 'work' && !m.manualPriceOverride && m.price > 0;
}

/**
 * Detect rows whose MONEY can't be right, whatever the match metadata says.
 * Returns at most one issue per row; reasons compound into the detail.
 */
export function detectImplausibleCostIssues(
  materials: Material[] | undefined | null,
  sections?: QuoteSection[] | null,
): QuoteIssue[] {
  const mats = (materials ?? []).filter(costCheckable);
  if (mats.length < 2) return [];
  const materialsTotal = mats.reduce((n, m) => n + lineTotal(m), 0);
  if (materialsTotal <= 0) return [];

  const reasons = new Map<string, string[]>();
  const note = (m: Material, why: string) => {
    const existing = reasons.get(m.id) || [];
    existing.push(why);
    reasons.set(m.id, existing);
  };

  // (a) identical-unit-price pairs
  const byPrice = new Map<string, Material[]>();
  for (const m of mats) {
    if (m.price < TWIN_PRICE_MIN) continue;
    const key = m.price.toFixed(2);
    byPrice.set(key, [...(byPrice.get(key) || []), m]);
  }
  for (const group of byPrice.values()) {
    if (group.length < 2) continue;
    const combined = group.reduce((n, m) => n + lineTotal(m), 0);
    if (combined / materialsTotal < TWIN_PRICE_MIN_COMBINED_SHARE) continue;
    for (const m of group) {
      const twins = group.filter((g) => g.id !== m.id).map((g) => `“${g.name}”`);
      note(
        m,
        `same $${m.price.toFixed(2)} unit price as ${twins.join(' and ')} — different products almost never price identically, so one of them matched the wrong item`,
      );
    }
  }

  // (b) auxiliary line dominating the materials money
  for (const m of mats) {
    if (!AUX_RE.test(m.name)) continue;
    const total = lineTotal(m);
    if (total < AUX_DOMINANT_MIN_TOTAL) continue;
    if (total / materialsTotal < AUX_DOMINANT_MIN_SHARE) continue;
    note(
      m,
      `$${total.toFixed(2)} of ${m.name.toLowerCase()} is ${Math.round((total / materialsTotal) * 100)}% of the materials money — the helper product should never be the biggest line, so the quantity or the matched product is off`,
    );
  }

  // (c) auxiliary spend per m² in an area-scaled section
  for (const s of sections ?? []) {
    if (!(s.multiplier >= AUX_PER_AREA_MIN_MULTIPLIER)) continue;
    for (const m of mats) {
      if (m.section !== s.name || !AUX_RE.test(m.name)) continue;
      const perArea = lineTotal(m) / s.multiplier;
      if (perArea <= AUX_PER_AREA_MAX_DOLLARS) continue;
      note(
        m,
        `works out to $${perArea.toFixed(0)} per m² of ${m.name.toLowerCase()} — no real product costs that much per square metre`,
      );
    }
  }

  const issues: QuoteIssue[] = [];
  for (const m of mats) {
    const why = reasons.get(m.id);
    if (!why?.length) continue;
    issues.push({
      materialId: m.id,
      name: m.name,
      kind: 'implausible_cost',
      detail: `${why.join('; ')}. Check it before this reaches a customer.`,
      price: m.price,
      quantity: m.quantity,
      unit: m.unit,
    });
  }
  return issues;
}

/**
 * Row ids whose PRICE should be wiped for a re-price. The per-row metadata
 * flags (isFlaggedRow) miss detector-level verdicts: QU-178763's three
 * $187.25 twins were all priceConfidence 'high', so a reprice reset ZERO
 * rows and "re-checked" the same wrong total. Inflated-quantity rows are
 * deliberately excluded — their price is fine, their quantity is the
 * problem, and wiping the price would just re-buy the same mistake.
 */
export function priceResettableIds(
  materials: Material[] | undefined | null,
  sections?: QuoteSection[] | null,
): Set<string> {
  const review = reviewQuoteMaterials(materials, sections);
  return new Set(
    review.issues.filter((i) => i.kind !== 'inflated_quantity').map((i) => i.materialId),
  );
}

/**
 * After a re-price, wipe the rows that came back just as implausible as they
 * went in. The re-fetch is deterministic (same search term, same cache, same
 * wrong product), so a reprice alone can loop the same bad match forever —
 * QU-178763's $187.25 twins re-priced to the exact same $187.25. A row that
 * was reset for implausible money and still shows implausible money gets its
 * price wiped to $0 with an honest description: the tradie sets it or deletes
 * the line, the review flags it 'unpriced', and the pre-send gate holds.
 */
export function wipeStillImplausibleRows(
  resetIds: ReadonlySet<string>,
  materials: Material[],
  sections?: QuoteSection[] | null,
): { materials: Material[]; wipedCount: number; wipedNames: string[] } {
  if (!resetIds.size) return { materials, wipedCount: 0, wipedNames: [] };
  const stillBad = new Set(
    detectImplausibleCostIssues(materials, sections)
      .map((i) => i.materialId)
      .filter((id) => resetIds.has(id)),
  );
  if (!stillBad.size) return { materials, wipedCount: 0, wipedNames: [] };
  const wipedNames: string[] = [];
  const next = materials.map((m) => {
    if (!stillBad.has(m.id)) return m;
    wipedNames.push(m.name);
    // Remember the identity of the product that kept winning, so the next
    // re-fetch is barred from re-picking it (pickBestCandidate's
    // excludeProducts) — and unlink it from the row: a $0 line pointing at
    // the wrong product page would send the tradie to the wrong shelf.
    const identity = [m.bunningsItemNumber, m.reeceItemNumber, m.productUrl].filter(
      (v): v is string => !!v,
    );
    const excludedProducts = Array.from(new Set([...(m.excludedProducts || []), ...identity]));
    return {
      ...m,
      price: 0,
      totalPrice: 0,
      priceConfidence: undefined,
      pricingSource: undefined,
      weakProductMatch: undefined,
      bunningsItemNumber: undefined,
      reeceItemNumber: undefined,
      productUrl: undefined,
      ...(excludedProducts.length ? { excludedProducts } : {}),
      description:
        "Re-pricing kept landing on a price that can't be right — set this one yourself or delete the line.",
    };
  });
  return { materials: next, wipedCount: wipedNames.length, wipedNames };
}

/**
 * The two or three lines carrying the most money, as one plain sentence.
 * Deterministic, for surfaces that show the tradie where the total lives —
 * an $8,239 adhesive line names itself the moment someone reads it out.
 */
export function topLinesSummary(
  materials: Material[] | undefined | null,
  count = 2,
): string {
  const rows = (materials ?? [])
    .filter((m) => m.kind !== 'work' && lineTotal(m) > 0)
    .sort((a, b) => lineTotal(b) - lineTotal(a))
    .slice(0, count);
  if (!rows.length) return '';
  const parts = rows.map(
    (m) => `${m.name} $${lineTotal(m).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  );
  return `Biggest lines: ${parts.join(', ')}.`;
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

  // Detector-level issues lead and win the dedupe — they carry the more
  // actionable story (a laundered or money-implausible row is usually also
  // low-confidence priced, and we don't want the same material listed twice).
  // Implausible-cost outranks inflated-quantity: "this line carries $8,239"
  // beats "this quantity looks scaled".
  const implausible = detectImplausibleCostIssues(materials, sections);
  const implausibleIds = new Set(implausible.map((i) => i.materialId));
  const inflated = detectAnchorLaunderedIssues(materials, sections).filter(
    (i) => !implausibleIds.has(i.materialId),
  );
  const detectorIds = new Set([...implausibleIds, ...inflated.map((i) => i.materialId)]);
  // Ordered by money at risk, because only the first three get named and the
  // tradie acts on those. Array order used to decide it: the carport quote
  // named two skip bins and road base (~$2,051 between them) and buried $2,386
  // of joint tape and $2,055 of insulation inside "+5 more".
  const issues = [
    ...implausible,
    ...inflated,
    ...rowIssues.filter((i) => !detectorIds.has(i.materialId)),
  ].sort((a, b) => issueMoney(b) - issueMoney(a));

  const counts = {
    unpriced: issues.filter((i) => i.kind === 'unpriced').length,
    estimated: issues.filter((i) => i.kind === 'estimated').length,
    lowConfidence: issues.filter((i) => i.kind === 'low_confidence').length,
    inflatedQuantity: issues.filter((i) => i.kind === 'inflated_quantity').length,
    weakMatch: issues.filter((i) => i.kind === 'weak_match').length,
    implausibleCost: issues.filter((i) => i.kind === 'implausible_cost').length,
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
 * print as $0 line items on the customer's copy), area-anchor-laundered
 * quantities (an absurd count like "165 silicone tubes" is a trust-killer on
 * the customer copy — see detectAnchorLaunderedIssues), or a row priced off a
 * product that barely matches the request. Estimated / low-confidence rows
 * alone don't gate the send (they're priced and flagged in the list already;
 * warning on every estimate would teach tradies to dismiss the dialog without
 * reading it) — a weak product match is different in kind: the number is a
 * real supplier price for what may be a completely different product, and it
 * carries real money (QU-178711's towel bars were 64% of the materials).
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
    /** The name on the document. A draft that skipped the customer to get a
     *  price out fast still carries a stand-in, and that must not reach a
     *  real customer's inbox. */
    customerName?: string;
  } = {},
): PresendWarning | null {
  const unpriced = review.issues.filter((i) => i.kind === 'unpriced');
  const inflated = review.issues.filter((i) => i.kind === 'inflated_quantity');
  const weak = review.issues.filter((i) => i.kind === 'weak_match');
  const implausible = review.issues.filter((i) => i.kind === 'implausible_cost');
  const placeholderCustomer = isPlaceholderCustomer(options.customerName);
  if (
    unpriced.length === 0 && inflated.length === 0 && weak.length === 0 &&
    implausible.length === 0 && !placeholderCustomer
  ) {
    return null;
  }

  const lines: string[] = [];

  if (placeholderCustomer) {
    lines.push(
      `This ${docLabel} is still made out to "${options.customerName}" — put the customer's real name on it before it goes out.`,
    );
  }

  // Money that can't be right leads — it's the fabricated-total family, the
  // one that costs a customer relationship if it goes out (QU-178763: $8,239
  // of tile adhesive on an 11 m² job, every flag green).
  if (implausible.length > 0) {
    const shown = implausible
      .slice(0, 3)
      .map((i) => `• ${i.name} (${i.quantity} × $${i.price.toFixed(2)} = $${(i.quantity * i.price).toFixed(2)})`);
    const more = implausible.length - shown.length;
    lines.push(
      `${implausible.length} ${implausible.length === 1 ? 'line carries' : 'lines carry'} money that doesn't look right for what ${implausible.length === 1 ? 'it is' : 'they are'} — check ${implausible.length === 1 ? 'it' : 'them'} before sending:`,
      ...shown,
      ...(more > 0 ? [`(+${more} more)`] : []),
    );
  }

  if (unpriced.length > 0) {
    if (lines.length > 0) lines.push('');
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

  if (weak.length > 0) {
    if (lines.length > 0) lines.push('');
    const shown = weak.slice(0, 3).map((i) => `• ${i.name} (${i.quantity} × $${i.price.toFixed(2)})`);
    const more = weak.length - shown.length;
    lines.push(
      `${weak.length} ${weak.length === 1 ? 'line was' : 'lines were'} priced off a product that doesn't look like a match — check ${weak.length === 1 ? 'it' : 'them'} before sending:`,
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

  if (placeholderCustomer && unpriced.length === 0 && inflated.length === 0 && weak.length === 0 && implausible.length === 0) {
    return { title: 'No customer name on this one', message: lines.join('\n') };
  }

  const pricesNeedALook = unpriced.length > 0 || weak.length > 0 || implausible.length > 0;
  const title =
    pricesNeedALook && inflated.length > 0
      ? 'Some prices and quantities need a look'
      : inflated.length > 0
        ? 'Some quantities need a look'
        : 'Some prices need a look';

  return { title, message: lines.join('\n') };
}

/**
 * Fold document-level arithmetic faults into a review so they reach the same
 * places the row flags do.
 *
 * `checkDocumentIntegrity` has always been able to catch these — a switchboard
 * quote stored 5 hours at $85 and charged $170, which is 2 hours — but it was
 * only ever imported by offline scripts, so the contradiction shipped to the
 * tradie. This is the seam that puts it on the live path.
 */
export function withIntegrityIssues(review: QuoteReview, details: string[]): QuoteReview {
  if (!details.length) return review;
  const noun = details.length === 1 ? 'figure' : 'figures';
  return {
    ...review,
    integrity: details,
    summary: `${review.summary} Also — ${details.length} ${noun} on this quote don't add up (${details[0]}).`,
  };
}

/**
 * Stand-in names a draft carries when the tradie wanted a price before they
 * wanted paperwork. Mate is told to use "Unnamed job"; the rest are what it and
 * tradies have actually reached for. Matched case-insensitively so a real
 * customer called "Self Storage Co" is untouched.
 */
const PLACEHOLDER_CUSTOMER_NAMES = new Set(['unnamed job', 'unnamed', 'self', 'customer', 'tbc', 'tba', 'n/a']);

export function isPlaceholderCustomer(name?: string): boolean {
  return PLACEHOLDER_CUSTOMER_NAMES.has((name || '').trim().toLowerCase());
}
