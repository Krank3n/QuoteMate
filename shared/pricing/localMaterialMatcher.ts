/**
 * Local Material Matcher — PURE functions.
 *
 * This file deliberately has zero side-effect imports (no Firebase, no
 * AsyncStorage, no RN). It hosts the scoring + ranking primitives so the
 * unit tests in `localMaterialSearch.test.ts` can hit them without spinning
 * up the React Native / Firebase module graph.
 *
 * The orchestrating loader (`searchLocalSources`) lives in
 * `localMaterialSearch.ts` and calls into this file.
 *
 * ─── Matcher design ──────────────────────────────────────────────────────────
 *
 * Real-world tradie supplier-book names are noisy and full of specs:
 *
 *   query   : "R2.5 HD insulation batts"
 *   target  : "Pink Batts Wall R2.5 HD 1160x580x90 12PK"
 *
 * An "all-tokens-must-appear" matcher fails this case (the target has no
 * literal "insulation"). The matcher below splits each side into three token
 * classes and scores per-token:
 *
 *   - NOISE        ignored entirely     install, supply, thermal, acoustic, …
 *   - SPEC         dim / R-value / size 90x45, r2.5, 12mm, h3, 2.4m, 1160x580x90
 *   - WORD         real product words   batts, posts, decking, paint, screws
 *
 * Per-token score against the target:
 *
 *   exact / plural-swap            1.00
 *   synonym hit                    0.95
 *   spec partial (r2.5 ⊂ r2.5hd)   0.90
 *   substring (≥3 char overlap)    0.80
 *
 * The aggregate match score is the (signal-weighted) mean of per-token scores,
 * with spec tokens carrying 1.25× weight (they're highly distinctive). The
 * matcher returns true when:
 *
 *   - aggregate score ≥ 0.60, AND
 *   - at least one WORD token scored > 0 (stops a query of just "R2.5"
 *     matching every R2.5 SKU in the supplier book), AND
 *   - if the query has SPEC tokens, ≥ 50% of them must hit (you typed a
 *     size for a reason).
 *
 * `scoreMatch` is exported so callers can rank multiple hits by actual match
 * quality, not just by saved supplier priority.
 */

import type { FavoriteProductMapping, SectionTemplate, SupplierGroup } from './types';

export type LocalSourceKind = 'template' | 'favorite';

export interface LocalSearchResult {
  productName: string;
  description: string;
  itemNumber: string;
  brand: string;
  price: number;
  productUrl?: string;
  imageUrl?: string;
  store: string;
  unit?: string;
  isLocalSource: true;
  isScraperResult: false;
  isAiEstimate: false;
  localSource: LocalSourceKind;
  localSourceLabel: string;
  _sortHint: number;
  _matchScore: number;
}

// ─── Tokenization & classification ──────────────────────────────────────────

/** Lowercase + collapse whitespace + normalise punctuation between specs.
 *  We intentionally keep "x" and "." inside tokens (90x45, R2.5) but split
 *  on " x " (with spaces) so "90 x 45" tokenises identically to "90x45". */
function norm(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[,;()\[\]"']/g, ' ')
    .replace(/\s*x\s*/g, 'x')
    .replace(/\s+/g, ' ');
}

/** Generic descriptor words the AI tends to sprinkle into searchTerms that
 *  rarely appear in saved-rate names. */
const MATCH_NOISE = new Set([
  'install', 'installation', 'installing', 'fit', 'fitting', 'fitted',
  'supply', 'supplied', 'fix', 'fixing', 'set',
  'thermal', 'standard', 'premium', 'budget', 'basic', 'high', 'low',
  'new', 'good', 'best', 'quality', 'duty', 'grade',
  'the', 'a', 'an', 'of', 'and', 'or', 'for', 'with', 'per', 'to', 'in', 'on',
  'at', 'by', 'as', 'is', 'be',
  'item', 'items', 'unit', 'units', 'each',
]);

/** Spec token patterns. R-values, dimensions, sizes with units, H-class, pack
 *  counts, and raw multi-digit numerics. */
const SPEC_PATTERNS: RegExp[] = [
  /^r\d+(\.\d+)?$/,
  /^\d+x\d+(x\d+)?$/,
  /^\d+(\.\d+)?(mm|cm|m|ml|l|kg|g|w)$/,
  /^h\d$/,
  /^\d+pk$/,
  /^\d{3,}$/,
];

function isSpec(token: string): boolean {
  return SPEC_PATTERNS.some((p) => p.test(token));
}

/** Narrow, high-confidence bidirectional synonym groups. Kept deliberately
 *  small — broad synonyms (e.g. concrete ↔ cement) cause cross-trade false
 *  positives. */
const SYNONYM_GROUPS: string[][] = [
  ['insulation', 'batts', 'batt'],
  ['plasterboard', 'gyprock', 'gib', 'plaster'],
  ['decking', 'deckboard'],
  ['screws', 'screw', 'fasteners', 'fastener', 'fixings', 'fixing'],
  ['paint', 'paints'],
  ['posts', 'post'],
  ['palings', 'paling'],
  ['weatherboard', 'weatherboards', 'cladding'],
  ['tile', 'tiles'],
  ['sealant', 'silicone'],
  ['nail', 'nails'],
];

const SYNONYM_BY_WORD = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  const set = new Set(group);
  for (const w of group) SYNONYM_BY_WORD.set(w, set);
}

function singular(w: string): string {
  return w.endsWith('s') && w.length > 2 ? w.slice(0, -1) : w;
}

function plural(w: string): string {
  return w.endsWith('s') ? w : w + 's';
}

type TokenClass = 'noise' | 'spec' | 'word';

export interface ClassifiedToken {
  raw: string;
  kind: TokenClass;
}

export function classifyTokens(text: string): ClassifiedToken[] {
  const tokens = norm(text).split(/[\s\-_/,]+/).filter((w) => w.length > 1);
  return tokens.map((raw) => {
    if (isSpec(raw)) return { raw, kind: 'spec' as TokenClass };
    if (MATCH_NOISE.has(raw)) return { raw, kind: 'noise' as TokenClass };
    return { raw, kind: 'word' as TokenClass };
  });
}

// ─── Per-token scoring ──────────────────────────────────────────────────────

function scoreToken(
  qTok: ClassifiedToken,
  targetTokens: ClassifiedToken[],
): number {
  if (qTok.kind === 'noise') return 0;
  const q = qTok.raw;
  const qSingular = singular(q);
  const qPlural = plural(q);
  const synSet = SYNONYM_BY_WORD.get(q) || SYNONYM_BY_WORD.get(qSingular);

  let best = 0;
  for (const t of targetTokens) {
    if (t.kind === 'noise') continue;
    const tw = t.raw;
    if (tw === q || tw === qSingular || tw === qPlural) {
      best = Math.max(best, 1.0);
      continue;
    }
    if (qTok.kind === 'word' && synSet && synSet.has(tw)) {
      best = Math.max(best, 0.95);
      continue;
    }
    if (qTok.kind === 'spec' && t.kind === 'spec') {
      if (tw.startsWith(q) || q.startsWith(tw)) {
        best = Math.max(best, 0.9);
        continue;
      }
    }
    if (q.length >= 3 && tw.length >= 3) {
      if (tw.includes(q) || q.includes(tw)) {
        best = Math.max(best, 0.8);
        continue;
      }
    }
  }
  return best;
}

// ─── Aggregate score + match decision ───────────────────────────────────────

/** Compute a 0..1 match score for `query` against `text`. 0 means no match. */
export function scoreMatch(query: string, text: string): number {
  const q = norm(query);
  const t = norm(text);
  if (!q || !t) return 0;

  const qToks = classifyTokens(q);
  const tToks = classifyTokens(t);

  // Whole-string substring is a strong signal — but only when the query
  // contains at least one WORD token. Otherwise a query of just "R2.5"
  // would substring-match every R2.5 SKU in the supplier book, which is
  // exactly the spec-only false positive the per-token guard further down
  // is trying to prevent.
  const queryHasWord = qToks.some((tk) => tk.kind === 'word');
  if (queryHasWord) {
    if (t === q) return 1.0;
    if (t.includes(q) && q.length >= 3) return 0.95;
    if (q.includes(t) && t.length >= 3) return 0.9;
  }

  const signalTokens = qToks.filter((tk) => tk.kind !== 'noise');
  if (signalTokens.length === 0) return 0;

  let totalScore = 0;
  let totalWeight = 0;
  let wordHits = 0;
  let specHits = 0;
  let specTotal = 0;
  for (const qt of signalTokens) {
    const weight = qt.kind === 'spec' ? 1.25 : 1.0;
    const s = scoreToken(qt, tToks);
    totalScore += s * weight;
    totalWeight += weight;
    if (s > 0) {
      if (qt.kind === 'word') wordHits += 1;
      if (qt.kind === 'spec') specHits += 1;
    }
    if (qt.kind === 'spec') specTotal += 1;
  }
  const aggregate = totalScore / totalWeight;

  if (wordHits === 0) return 0;
  if (specTotal > 0 && specHits / specTotal < 0.5) return 0;

  return aggregate;
}

/** Match threshold — `scoreMatch` ≥ 0.6 counts as a hit. */
export const LOCAL_MATCH_THRESHOLD = 0.6;

/** True when `query` matches `text` well enough to surface as a local hit. */
export function looseMatch(query: string, text: string): boolean {
  return scoreMatch(query, text) >= LOCAL_MATCH_THRESHOLD;
}

// ─── Supplier <-> favourite linking ─────────────────────────────────────────

function favoriteBelongsToSupplier(
  fav: FavoriteProductMapping,
  supplierNamesLower: Set<string>
): boolean {
  const store = fav.store?.trim().toLowerCase();
  if (!store) return false;
  if (supplierNamesLower.has(store)) return true;
  for (const name of supplierNamesLower) {
    if (store.includes(name) || name.includes(store)) return true;
  }
  return false;
}

// ─── Search drivers (pure — given input arrays) ─────────────────────────────

export function searchTemplates(
  query: string,
  templates: SectionTemplate[]
): LocalSearchResult[] {
  const results: LocalSearchResult[] = [];
  for (const tpl of templates) {
    const tplScore = Math.max(
      scoreMatch(query, tpl.name),
      ...(tpl.keywords?.map((kw) => scoreMatch(query, kw)) ?? [0]),
    );
    const templateMatches = tplScore >= LOCAL_MATCH_THRESHOLD;

    for (const mat of tpl.materials) {
      const matScore = scoreMatch(query, mat.name);
      const matMatches = matScore >= LOCAL_MATCH_THRESHOLD;
      if (!templateMatches && !matMatches) continue;
      if (typeof mat.price !== 'number' || mat.price <= 0) continue;

      const effectiveScore = matMatches ? matScore : tplScore;
      results.push({
        productName: mat.name,
        description: `From template: ${tpl.name}`,
        itemNumber: '',
        brand: '',
        price: mat.price,
        productUrl: undefined,
        imageUrl: undefined,
        store: tpl.name,
        unit: mat.unit,
        isLocalSource: true,
        isScraperResult: false,
        isAiEstimate: false,
        localSource: 'template',
        localSourceLabel: `From template: ${tpl.name}`,
        // Templates rank above favourites by default. Subtract the match
        // score so a better-matching template beats a worse one.
        _sortHint: -effectiveScore,
        _matchScore: effectiveScore,
      });
    }
  }
  return results;
}

export function searchFavorites(
  query: string,
  favorites: FavoriteProductMapping[],
  suppliers: SupplierGroup[],
  priorityOrder?: string[]
): LocalSearchResult[] {
  const supplierNamesLower = new Set(suppliers.map(s => s.name.trim().toLowerCase()));
  const priorityIndexById = new Map<string, number>();
  (priorityOrder ?? []).forEach((id, idx) => {
    if (id) priorityIndexById.set(id, idx);
  });
  const sortOrderByName = new Map(
    suppliers.map(s => {
      const priIdx = priorityIndexById.get(s.id);
      const order = priIdx !== undefined ? priIdx : (s.sortOrder ?? 999);
      return [s.name.trim().toLowerCase(), order];
    })
  );

  const results: LocalSearchResult[] = [];
  for (const fav of favorites) {
    const belongsToSupplier = favoriteBelongsToSupplier(fav, supplierNamesLower);
    if (!belongsToSupplier && fav.isPersonalRate !== true) continue;

    // Score productName / keywords / notes individually; take the max. A
    // combined haystack would give a long string an artificial substring
    // advantage at scoreMatch's short-circuit.
    const candidates: string[] = [
      fav.productName,
      ...(fav.keywords ?? []),
      ...(fav.notes ? [fav.notes] : []),
    ].filter(Boolean);
    let bestScore = 0;
    for (const c of candidates) {
      const s = scoreMatch(query, c);
      if (s > bestScore) bestScore = s;
    }
    if (bestScore < LOCAL_MATCH_THRESHOLD) continue;
    if (typeof fav.price !== 'number' || fav.price <= 0) continue;

    const storeLower = fav.store?.trim().toLowerCase() ?? '';
    let supplierRank = sortOrderByName.get(storeLower);
    if (supplierRank === undefined) {
      for (const [name, order] of sortOrderByName.entries()) {
        if (storeLower.includes(name) || name.includes(storeLower)) {
          supplierRank = order;
          break;
        }
      }
    }
    const effectiveSupplierRank = supplierRank ?? 999;

    // Composite sort: supplier rank dominates (honour user's saved
    // priority), then match score breaks ties within the same supplier.
    const _sortHint = effectiveSupplierRank + (1 - bestScore) * 0.01;

    results.push({
      productName: fav.productName,
      description: `From ${fav.store}`,
      itemNumber: fav.itemNumber ?? '',
      brand: '',
      price: fav.price,
      productUrl: fav.productUrl,
      imageUrl: fav.imageUrl,
      store: fav.store,
      unit: fav.unit,
      isLocalSource: true,
      isScraperResult: false,
      isAiEstimate: false,
      localSource: 'favorite',
      localSourceLabel: `From ${fav.store}`,
      _sortHint,
      _matchScore: bestScore,
    });
  }
  return results;
}
