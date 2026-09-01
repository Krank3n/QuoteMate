/**
 * Deterministic scoring. No LLM judgement here — these are arithmetic facts
 * about each quote line, measured against the real product listings.
 *
 * Two independent questions, because they fail independently:
 *
 *  1. COVERAGE — does what the arm says to buy actually cover what the job
 *     needs? (22 × 20kg bags for a 440 kg requirement = yes. 440 bags = no.)
 *     This is the 1000×/440-bag/8-roll family.
 *
 *  2. PRICE REALISM — is the money on the line what that requirement really
 *     costs at Bunnings today? This is the question that decides whether
 *     "ask Claude directly" is genuinely better or merely plausible: a quote
 *     can have perfect internal arithmetic and still be built on invented
 *     shelf prices.
 *
 * Both are computed from ProductFacts (an independent read of the listing),
 * never from the app's own parsePackInfo — grading the pipeline with the
 * regex that produces its bugs would score every pack error as correct.
 */

import { ProductFacts, QuoteLine, ScraperProduct, Unit } from './types';
import { factsKey } from './productFacts';
import { normalisedPrice } from './scraper';

/** Purchase units collapse to 'each'; measurement units stand alone. */
export function baseUnit(u: Unit | string): string {
  const s = String(u);
  if (s === 'pack' || s === 'box' || s === 'each') return 'each';
  return s;
}

export type CoverageStatus =
  | 'ok'
  | 'under'
  | 'over'
  | 'unpriced'
  /** Priced from a fallback/model estimate — there is no SKU whose pack size
   *  could be checked. Not a defect by itself, but it means the money on the
   *  line is unverifiable, which is the whole question for claude-direct. */
  | 'no-sku'
  /** A real SKU, but its yield unit cannot be compared to the requirement. */
  | 'unknown';

export interface LineScore {
  name: string;
  /** How many times the requirement the purchase actually covers. 1.0 = exact. */
  coverageRatio: number | null;
  coverage: CoverageStatus;
  /** line total ÷ what it really costs to cover the requirement. */
  costRatio: number | null;
  realCost: number | null;
  lineTotal: number;
  /** quantity × unitPrice === totalPrice */
  arithmeticOk: boolean;
  priceSource: QuoteLine['priceSource'];
  detail?: string;
}

/** Under-buying is always a defect. Over-buying is only a defect past waste. */
const UNDER_BUY = 0.95;
const OVER_BUY = 2.0;
/** Money on a line is "wrong" outside this band vs the real cost to cover it. */
const COST_UNDER = 0.5;
const COST_OVER = 2.0;
/** Beyond this many purchases of one SKU, it is not the right supply unit. */
const MAX_PURCHASES = 100;
/** Candidates dearer than this multiple of the cheapest are treated as misreads. */
const OUTLIER_MULTIPLE = 5;

function coverageOf(line: QuoteLine, facts: ProductFacts | undefined): { ratio: number | null; status: CoverageStatus } {
  if (!(line.unitPrice > 0)) return { ratio: null, status: 'unpriced' };
  // No product was chosen at all — a fallback estimate or the model's own
  // price. There is nothing to check the pack maths against.
  if (!line.productName) return { ratio: null, status: 'no-sku' };
  if (!facts) return { ratio: null, status: 'unknown' };
  const req = line.requiredQty;
  if (!(req > 0)) return { ratio: null, status: 'unknown' };

  const reqBase = baseUnit(line.requiredUnit);
  const yieldBase = baseUnit(facts.yieldUnit);

  let covered: number | null = null;
  if (reqBase === yieldBase) {
    covered = line.quantity * facts.yieldAmount;
  } else if (reqBase === 'each' && facts.piecesPerPurchase) {
    // A requirement counted in pieces against a multi-piece pack.
    covered = line.quantity * facts.piecesPerPurchase;
  }
  if (covered === null) return { ratio: null, status: 'unknown' };

  const ratio = covered / req;
  if (ratio < UNDER_BUY) return { ratio, status: 'under' };
  if (ratio > OVER_BUY) return { ratio, status: 'over' };
  return { ratio, status: 'ok' };
}

/**
 * What it really costs to cover this line's requirement, from the real
 * candidate listings for the line's own search term. Median across compatible
 * candidates so one oddly-priced SKU can't move the verdict.
 */
export function realCostToCover(
  line: QuoteLine,
  candidates: ScraperProduct[],
  facts: Map<string, ProductFacts>,
): { cost: number | null; basis: string } {
  const req = line.requiredQty;
  if (!(req > 0)) return { cost: null, basis: 'no requirement' };
  const reqBase = baseUnit(line.requiredUnit);

  const costs: number[] = [];
  for (const c of candidates) {
    const f = facts.get(factsKey({ itemNumber: c.itemNumber, productName: c.productName }));
    if (!f || !(f.yieldAmount > 0)) continue;
    const price = normalisedPrice(c);
    if (!(price > 0)) continue;
    const yieldBase = baseUnit(f.yieldUnit);
    let purchases: number | null = null;
    if (reqBase === yieldBase) purchases = Math.ceil(req / f.yieldAmount);
    else if (reqBase === 'each' && f.piecesPerPurchase) purchases = Math.ceil(req / f.piecesPerPurchase);
    if (purchases === null || !Number.isFinite(purchases)) continue;
    // A candidate that would have to be bought MAX_PURCHASES times over is not
    // the supply unit for this requirement — it is a mis-read listing or the
    // wrong product entirely. Letting one through is how "340 framing nails"
    // acquired an $80,240 ground-truth cost (a $236 tool read as one nail),
    // which would have made every arm's price realism meaningless on that job.
    if (purchases > MAX_PURCHASES) continue;
    costs.push(Math.max(1, purchases) * price);
  }
  if (costs.length === 0) return { cost: null, basis: 'no plausible compatible candidate' };
  costs.sort((a, b) => a - b);
  // Drop candidates far above the cheapest sensible way to buy the requirement
  // before taking the median: with only two candidates a single bad reading
  // would otherwise pull the baseline halfway to it.
  const cheapest = costs[0];
  const kept = costs.filter((x) => x <= cheapest * OUTLIER_MULTIPLE);
  const mid = Math.floor(kept.length / 2);
  const median = kept.length % 2 ? kept[mid] : (kept[mid - 1] + kept[mid]) / 2;
  return { cost: Math.round(median * 100) / 100, basis: `median of ${kept.length}/${costs.length} plausible candidate(s)` };
}

export function scoreLine(
  line: QuoteLine,
  facts: Map<string, ProductFacts>,
  candidatesForTerm: ScraperProduct[],
): LineScore {
  const own = line.productName ? facts.get(factsKey({ itemNumber: line.itemNumber, productName: line.productName })) : undefined;
  const { ratio, status } = coverageOf(line, own);
  const { cost } = realCostToCover(line, candidatesForTerm, facts);

  const expectedTotal = Math.round(line.quantity * line.unitPrice * 100) / 100;
  const arithmeticOk = Math.abs(expectedTotal - line.totalPrice) <= 0.02;

  return {
    name: line.name,
    coverageRatio: ratio === null ? null : Math.round(ratio * 1000) / 1000,
    coverage: status,
    costRatio: cost && cost > 0 && line.totalPrice > 0 ? Math.round((line.totalPrice / cost) * 1000) / 1000 : null,
    realCost: cost,
    lineTotal: line.totalPrice,
    arithmeticOk,
    priceSource: line.priceSource,
    detail: own ? `${own.yieldAmount} ${own.yieldUnit}/purchase (${own.note || own.confidence})` : undefined,
  };
}

export interface ArmScore {
  arm: string;
  lineCount: number;
  /** Lines whose purchase does not cover the requirement. The dangerous ones. */
  underBuy: number;
  overBuy: number;
  coverageOk: number;
  coverageUnknown: number;
  /** Lines with no SKU behind the money (fallback table or model knowledge). */
  noSkuLines: number;
  unpricedLines: number;
  arithmeticBreaks: number;
  /** Lines carrying money more than 2× or less than 0.5× the real cost. */
  costWayOff: number;
  costComparable: number;
  /** Median |log| cost error across comparable lines — 0 is perfect. */
  medianCostRatio: number | null;
  /** Sum of arm's totals vs sum of real costs, over comparable lines only. */
  armSubtotalOnComparable: number;
  realSubtotalOnComparable: number;
  subtotal: number;
}

export function scoreArm(arm: string, scores: LineScore[], subtotal: number): ArmScore {
  const comparable = scores.filter((s) => s.costRatio !== null);
  const ratios = comparable.map((s) => s.costRatio!).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length === 0 ? null : ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;

  return {
    arm,
    lineCount: scores.length,
    underBuy: scores.filter((s) => s.coverage === 'under').length,
    overBuy: scores.filter((s) => s.coverage === 'over').length,
    coverageOk: scores.filter((s) => s.coverage === 'ok').length,
    coverageUnknown: scores.filter((s) => s.coverage === 'unknown').length,
    noSkuLines: scores.filter((s) => s.coverage === 'no-sku').length,
    unpricedLines: scores.filter((s) => s.coverage === 'unpriced').length,
    arithmeticBreaks: scores.filter((s) => !s.arithmeticOk).length,
    costWayOff: comparable.filter((s) => s.costRatio! < COST_UNDER || s.costRatio! > COST_OVER).length,
    costComparable: comparable.length,
    medianCostRatio: median === null ? null : Math.round(median * 1000) / 1000,
    armSubtotalOnComparable: Math.round(comparable.reduce((s, x) => s + x.lineTotal, 0) * 100) / 100,
    realSubtotalOnComparable: Math.round(comparable.reduce((s, x) => s + (x.realCost || 0), 0) * 100) / 100,
    subtotal,
  };
}
