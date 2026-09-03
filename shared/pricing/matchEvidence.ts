/**
 * Match evidence — how much a supplier product actually resembles the row we
 * searched for, judged deterministically from the two names alone.
 *
 * Why this exists: the Bunnings scraper stamps EVERY hit `confidence: 'high'`
 * (that flag describes the scrape, not the match), and the search happily
 * returns a lexical near-miss when the store simply doesn't stock the product.
 * On QU-178711 a concreter's "N12 starter bar 600mm dowel" matched a
 * "Mondella 935mm Chrome Resonance Double Towel Bar" at $85 — 30 of them,
 * $2,550, presented as a high-confidence supplier price on a $7.6k quote. The
 * row's only tie to the query was the word "bar". The same run matched
 * "builders tie wire roll 1.5mm" to a "Ryobi 1.6mm Rotary Tool Grout Removal
 * Bit" with no shared word at all.
 *
 * candidateRanker's `isSemanticallyCompatible` is a hand-written list of
 * category rules — it catches the families someone has already been burned by
 * and nothing else. This module is the general backstop underneath it: it asks
 * only "does this product name carry ANY evidence it is the thing we asked
 * for?", which needs no per-trade knowledge.
 *
 *   'none'   — not one shared word or dimension. Never apply: the ranker drops
 *              these so the row falls to the estimate path instead.
 *   'weak'   — a single incidental word in common ("bar"). Apply, but the row
 *              is stamped low-confidence so quoteReview, Mate's review_quote
 *              and the send gate all surface it.
 *   'strong' — enough overlap to trust the match as much as the supplier does.
 *
 * Deliberately lexical and cheap: it runs per candidate inside the ranker, and
 * a rule that needs a network call or a model would not be a backstop.
 */

import type { Material } from './types';
import { tradeFallbackUnitPriceWithUnit } from './tradeFallback';

export type MatchEvidence = 'strong' | 'weak' | 'none';

/**
 * Words that say nothing about WHICH product this is. Kept tight on purpose —
 * a material word like "steel" or "copper" is real evidence, so it stays in.
 * These are packaging, marketing and grading filler that appear across every
 * category.
 */
const GENERIC_WORDS = new Set([
  'and', 'the', 'for', 'with', 'per', 'from', 'into', 'onto',
  // Packaging and count nouns only. "bag", "box" and "roll" are deliberately
  // NOT here: they are often the head noun ("bag of rags", "junction box"),
  // and treating them as filler refused correct matches on the audit corpus.
  'pack', 'packs', 'packet', 'each', 'set', 'sets', 'kit', 'kits',
  'piece', 'pieces', 'pce', 'pcs', 'size', 'sizes',
  'heavy', 'duty', 'light', 'standard', 'premium', 'budget', 'quality', 'grade', 'type',
  'new', 'plus', 'pro', 'max', 'multi', 'general', 'purpose', 'use',
]);

/** Length units we can put on one scale (millimetres) so "3.6m" === "3600mm". */
const LENGTH_TO_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000 };

/**
 * Fold a word to its stem so two spellings of the same thing meet.
 *
 * Deliberately inflectional only — never derivational. Stripping -er would
 * fold "painter" onto "paint" and -all would fold "coveralls" onto "cover",
 * which is how "Disposable painters coveralls" came to be priced as a paint
 * roller cover in the first place. -es only collapses after a sibilant
 * ("boxes" → "box"); applying it blindly turned "hinges" into "hing" and made
 * a legitimate hinge match look like no evidence at all.
 *
 * The -ing/-ed arm (with consonant undoubling) is what lets "punched metal
 * strap bracing" meet "Galvanised Strapping", and "Spotting chemicals" meet
 * "Spot and Stain Remover" — both correct matches the audit caught this
 * refusing. The 4-character floor stops "string" collapsing to "str".
 */
function stem(t: string): string {
  const inflected = t.match(/^(.{4,}?)(?:ing|ed|en)$/);
  if (inflected) {
    const base = inflected[1];
    // "strapping" → "strapp" → "strap"; "spotting" → "spott" → "spot".
    return /([bdfglmnprt])\1$/.test(base) ? base.slice(0, -1) : base;
  }
  if (t.length > 4 && /(?:s|x|z|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && /[^s]s$/.test(t)) return t.slice(0, -1);
  return t;
}

function rawTokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    // "140x45mm" and "100 x 100 x 5" are one dimension chain, not one word —
    // split them so each number can be compared on its own.
    .replace(/(\d)\s*[x×]\s*(?=\d)/g, '$1 ')
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);
}

interface Fingerprint {
  words: Set<string>;
  /** Lengths in mm, plus non-length measures kept as "4.5kg"-style keys. */
  measures: Set<string>;
  /**
   * Adjacent word pairs run together, so a spaced phrase can meet the same
   * thing written closed up: "hole saw" -> "holesaw", "down pipe" ->
   * "downpipe". Without this the corpus refused a genuine Bi-Metal Holesaw
   * for a "Hole Saw Kit" row.
   */
  compounds: Set<string>;
}

function fingerprint(s: string): Fingerprint {
  const words = new Set<string>();
  const measures = new Set<string>();
  const ordered: string[] = [];
  for (const t of rawTokens(s)) {
    const m = t.match(/^(\d+(?:\.\d+)?)(mm|cm|m|kg|g|l|ml)?$/);
    if (m) {
      const n = parseFloat(m[1]);
      const unit = m[2] || '';
      if (!(n > 0)) continue;
      // Two decimals, not whole millimetres: rounding collapsed 1.5mm tie
      // wire onto a 1.6mm rotary bit and made them look like the same spec.
      if (unit in LENGTH_TO_MM) measures.add(`${Number((n * LENGTH_TO_MM[unit]).toFixed(2))}mm`);
      else if (unit) measures.add(`${n}${unit}`);
      // A bare number carries no unit, so record it on the length scale too —
      // "90x45" and "90 x 45mm" are the same timber.
      else measures.add(`${Number(n.toFixed(2))}mm`);
      continue;
    }
    // Trailing-unit forms the split above leaves alone ("600mm" already
    // handled; "1200w", "10a" are kept as words — they're specs, not sizes).
    if (t.length <= 2) continue;
    const w = stem(t.replace(/\./g, ''));
    if (w.length > 2 && !GENERIC_WORDS.has(w)) {
      words.add(w);
      ordered.push(w);
    }
  }
  const compounds = new Set<string>();
  for (let i = 1; i < ordered.length; i += 1) compounds.add(ordered[i - 1] + ordered[i]);
  return { words, measures, compounds };
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const v of a) if (b.has(v)) n += 1;
  return n;
}

/** Fraction of the query's own words the product name accounts for. */
const STRONG_WORD_COVERAGE = 1 / 3;
/** A fully-matched dimension chain this long identifies the product by spec. */
const SPEC_MATCH_MIN_MEASURES = 2;

/**
 * Grade how much the product name backs up the search term.
 *
 * A query with nothing to judge on (empty, or only filler) returns 'strong' —
 * absence of a signal must never be read as evidence of a bad match.
 */
export function matchEvidence(query: string, productName: string): MatchEvidence {
  const q = fingerprint(query);
  const p = fingerprint(productName);
  if (q.words.size === 0 && q.measures.size === 0) return 'strong';
  if (!productName) return 'none';

  const sharedWords =
    intersectionSize(q.words, p.words) +
    intersectionSize(q.compounds, p.words) +
    intersectionSize(p.compounds, q.words);
  const sharedMeasures = intersectionSize(q.measures, p.measures);

  // A lone shared dimension is not evidence — "1.5mm" appears on a tie wire
  // roll and on a rotary burr alike, and that coincidence was enough to let a
  // grout-removal bit through. Only a spec CHAIN (two or more agreeing
  // measurements) can stand in for a shared word.
  const specChain = q.measures.size >= SPEC_MATCH_MIN_MEASURES;
  if (sharedWords === 0 && (sharedMeasures === 0 || !specChain)) return 'none';

  // Dimensional goods are identified by their spec: a "140x45mm 3.6m" rafter
  // request against "140 x 45mm MGP10 Pine Framing 3.6m" shares no noun, but
  // the whole dimension chain agrees — that IS the product.
  if (specChain && sharedMeasures === q.measures.size) return 'strong';

  if (q.words.size === 0) return sharedMeasures > 0 ? 'strong' : 'none';

  // Agreement on WHAT it is (a shared word) and WHAT SIZE it is (a shared
  // dimension) is evidence on both axes, and outranks bare word coverage.
  // Without it a "20mm corrugated condensate drain pipe" row dropped the
  // 20mm corrugated conduit it had matched and took a 2.5m washing-machine
  // drain hose at 2.3x the price, purely on having one more shared word.
  if (sharedWords > 0 && sharedMeasures > 0) return 'strong';

  // A compound hit can push the count past the word total; cap the ratio.
  return Math.min(sharedWords, q.words.size) / q.words.size >= STRONG_WORD_COVERAGE
    ? 'strong'
    : 'weak';
}

/** Row note for a match the deterministic evidence check can't vouch for. */
export const WEAK_MATCH_NOTE =
  "Not sure this is the right product — check it against your supplier before sending";

/**
 * Reconcile the row's confidence with how much the chosen product actually
 * resembles what we searched for.
 *
 * The supplier's own `confidence` describes the SCRAPE, not the match — every
 * Bunnings hit comes back 'high', so a lexical near-miss inherited 'high' and
 * sailed past quoteReview, Mate's review_quote and the send gate. QU-178711
 * shipped 30 chrome towel bars at $85 for "N12 starter bar 600mm dowel" —
 * $2,550, 64% of the materials on the quote, with nothing marking it as
 * doubtful. A weak match is still applied (an estimate is not obviously
 * better), but it is never presented as a confident supplier price.
 */
export function stampMatchConfidence(m: Material, productName?: string): void {
  const lexicallyWeak = matchEvidence(m.searchTerm || m.name, productName || '') === 'weak';
  const priceImplausible = !lexicallyWeak && pricedFarAboveTrade(m);
  if (!lexicallyWeak && !priceImplausible) {
    // Explicitly cleared, not just skipped: a re-price that finally lands a
    // proper product must drop the old warning, or the row stays flagged for
    // the life of the quote.
    m.weakProductMatch = undefined;
    return;
  }
  m.weakProductMatch = true;
  m.priceConfidence = 'low';
  const reason = priceImplausible ? IMPLAUSIBLE_PRICE_NOTE : WEAK_MATCH_NOTE;
  const note = typeof m.description === 'string' && m.description && m.description !== reason
    ? `${reason}. ${m.description}`
    : reason;
  m.description = note;
}

/** Row note for a match whose money gives it away, whatever the names share. */
export const IMPLAUSIBLE_PRICE_NOTE =
  "That unit price is far above what this normally costs — check it's the right product";

/**
 * How many times the trade estimate a real price may reach before the product
 * itself is in doubt. Deliberately generous: brand, grade and bulk packs all
 * move a real price around, and this only flags — it never repairs.
 */
const IMPLAUSIBLE_PRICE_MULTIPLE = 8;

/**
 * Word overlap alone can't tell a product from its accessories: "Ekodeck
 * decking screws" shares 2 of its 3 words with an Ekodeck composite decking
 * BOARD, scores 0.67 against a 0.33 bar, and graded 'strong'. Fifty of them at
 * $98.23 put $4,911 of screws on a $13k deck.
 *
 * The money says what the names can't. tradeFallbackUnitPrice is already a
 * curated view of what things cost per unit, so where it has an opinion in the
 * row's own unit, a price many times over it means we priced something else.
 * Screws at $98.23 each sit 1,228x above the table's $0.08.
 */
function pricedFarAboveTrade(m: Material): boolean {
  if (!(m.price > 0) || m.manualPriceOverride) return false;
  const hit = tradeFallbackUnitPriceWithUnit(`${m.searchTerm || ''} ${m.name || ''}`, m.unit);
  // Only compare like with like — a per-each opinion says nothing about the
  // price of a pack.
  if (!hit || hit.per !== m.unit || !(hit.price > 0)) return false;
  return m.price / hit.price >= IMPLAUSIBLE_PRICE_MULTIPLE;
}
