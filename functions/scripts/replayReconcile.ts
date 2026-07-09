/**
 * Replay-side reconcile pass — mirrors the production flow in
 * src/services/materialsPipeline.ts (reconcile decisions + deterministic
 * coverage sweep) so the replay audit grades the FULL pipeline, not a
 * truncated one. Uses the same shared prompt (src/reconcile.helpers.ts) and
 * the same deterministic guards (purchaseCoverage / geometricCoverage /
 * parsePackInfo) production uses.
 *
 * One deliberate difference: production converts prices to the business's GST
 * mode (supplierPriceForGstMode); the replay works inc-GST throughout, so
 * prices are used as-is.
 */

import { coverageSanePurchaseCount, coverageFloorPurchaseCount } from '../../src/utils/purchaseCoverage';
import { parseJobAreaM2, geometricSanePieceCount } from '../../src/utils/geometricCoverage';
import { parsePackInfo } from '../../src/utils/parsePackInfo';
import { simplifySearchTerm } from '../../src/utils/simplifySearchTerm';
import { isSemanticallyCompatible } from '../../src/services/candidateRanker';
import { ReconcileItem, ReconcileItemCandidate, ReconcileDecision } from '../src/reconcile.helpers';

export interface ReplayScraperCandidate {
  productName: string;
  description?: string;
  price: number;
  priceIncGst?: number;
  itemNumber?: string;
  productUrl?: string;
  confidence?: string;
  packSize?: number;
  packUnit?: string;
}

export interface ReplayPricedRow {
  name: string;
  searchTerm: string;
  quantity: number;
  unit: string;
  price: number;
  totalPrice: number;
  priceStatus: string;
  requiredQty?: number;
  requiredUnit?: string;
  chosen?: {
    name?: string;
    price?: number;
    confidence?: string;
    itemNumber?: string;
    pack?: { packSize: number; packUnit: string } | null;
  };
  reconcile?: { decision: string; confidence?: string; note?: string };
  [k: string]: any;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build reconcile items the same way materialsPipeline does: every row that
 * has search candidates goes to the LLM with its top-5 candidates, pack sizes
 * forwarded (supplied by the scraper or parsed from the title). Rows priced
 * via the deterministic trade fallback never had a retail search applied, so
 * they skip reconcile — production has no candidate rows for those either.
 */
export function buildReconcileItems(
  rows: ReplayPricedRow[],
  candidatesBySearchTerm: Map<string, ReplayScraperCandidate[]>
): { items: ReconcileItem[]; candidatesById: Map<string, ReconcileItemCandidate[]> } {
  const items: ReconcileItem[] = [];
  const candidatesById = new Map<string, ReconcileItemCandidate[]>();
  rows.forEach((row, i) => {
    // Non-retail rows never reconcile — the batch search prefetches
    // candidates for every term, so without this skip an unpriced trade row
    // (e.g. "PPE Consumables Allowance") gets handed retail candidates the
    // routing already excluded and the LLM applies one (ear muffs, $11).
    if (row.priceStatus === 'estimated-trade' || row.priceStatus === 'unpriced-trade') return;
    // Same semantic/spec gate as round-1 ranking — the reconcile LLM must
    // never be offered a candidate the gate already refused (70x35 framing
    // for a 140x45 rafter request).
    const cands = (candidatesBySearchTerm.get(row.searchTerm) || []).filter((c) =>
      isSemanticallyCompatible(row.searchTerm || row.name, c.productName || '')
    );
    if (cands.length === 0) return;
    const id = `row-${i}`;
    const mapped = cands.slice(0, 5).map((c) => {
      const parsed = parsePackInfo(c.productName);
      return {
        name: c.productName,
        price: c.priceIncGst || c.price,
        url: c.productUrl,
        description: c.description,
        packSize: c.packSize ?? parsed?.packSize,
        packUnit: c.packUnit ?? parsed?.packUnit,
      };
    });
    items.push({
      id,
      name: row.searchTerm || row.name,
      requirement: row.requiredQty ?? row.quantity,
      // requiredQty is in the ORIGINAL generation unit — labelling it with
      // the pack unit made the LLM divide each-requirements by pack lengths
      // (7 posts → 3). Same fix as production's reconcile item builder.
      requirementUnit: row.requiredUnit ?? row.chosen?.pack?.packUnit ?? row.unit,
      candidates: mapped,
    });
    candidatesById.set(id, mapped);
  });
  return { items, candidatesById };
}

/**
 * Apply reconcile decisions to the priced rows — same semantics as
 * materialsPipeline: reject zeroes the row, estimate re-prices from general
 * knowledge (coverage-guarded), apply re-prices from the chosen candidate
 * (coverage-guarded using its pack size). Rows without a decision pass
 * through unchanged. Returns new row objects; does not mutate the input.
 */
export function applyReconcileDecisions(
  rows: ReplayPricedRow[],
  decisions: ReconcileDecision[],
  candidatesById: Map<string, ReconcileItemCandidate[]>
): ReplayPricedRow[] {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  return rows.map((row, i) => {
    const r = byId.get(`row-${i}`);
    if (!r) return row;
    const m: ReplayPricedRow = { ...row };
    if (r.decision === 'reject') {
      m.price = 0;
      m.totalPrice = 0;
      m.priceStatus = 'rejected';
      m.reconcile = { decision: 'reject', note: r.rejectReason || 'Product mismatch — verify before sending' };
      return m;
    }
    if (
      r.decision === 'estimate' &&
      typeof r.estimatedUnitPrice === 'number' &&
      r.estimatedUnitPrice > 0 &&
      typeof r.purchaseCount === 'number' &&
      r.purchaseCount > 0
    ) {
      if (m.requiredQty === undefined) m.requiredQty = m.quantity;
      let count = r.purchaseCount;
      const sane = coverageSanePurchaseCount({
        requirement: m.requiredQty,
        name: m.name,
        perPurchasePrice: r.estimatedUnitPrice,
      });
      if (sane !== null && sane < count) count = sane;
      m.quantity = count;
      if (r.purchaseUnit) m.unit = r.purchaseUnit;
      m.price = round2(r.estimatedUnitPrice);
      m.totalPrice = round2(m.price * count);
      m.priceStatus = 'estimated-reconcile';
      m.chosen = undefined;
      m.reconcile = { decision: 'estimate', confidence: r.confidence || 'low', note: r.coverageNote || r.reasoning };
      return m;
    }
    if (r.decision === 'apply' && typeof r.purchaseCount === 'number' && r.purchaseCount > 0) {
      const cands = candidatesById.get(`row-${i}`) || [];
      const idx = typeof r.chosenIndex === 'number' ? r.chosenIndex : 0;
      const chosen = cands[idx];
      if (m.requiredQty === undefined) m.requiredQty = m.quantity;
      const candidatePrice = chosen && chosen.price > 0 ? chosen.price : 0;
      const impliedUnit =
        candidatePrice > 0
          ? candidatePrice
          : typeof r.totalPrice === 'number' && r.totalPrice > 0
            ? r.totalPrice / r.purchaseCount
            : 0;
      const parsedPack = parsePackInfo(chosen?.name);
      const packSize = chosen?.packSize ?? parsedPack?.packSize;
      const packUnit = chosen?.packUnit ?? parsedPack?.packUnit;
      let count = r.purchaseCount;
      // Coverage floor against under-buys, then the over-buy clamp — same
      // order and semantics as production's apply path.
      const floor = coverageFloorPurchaseCount({
        requirement: m.requiredQty,
        correctedRequirement: r.correctedRequirement,
        name: m.name,
        requirementUnit: m.requiredUnit ?? m.chosen?.pack?.packUnit ?? m.unit,
        packSize: packSize ?? undefined,
        packUnit,
      });
      if (floor !== null && floor > count) count = floor;
      const sane = coverageSanePurchaseCount({
        requirement: m.requiredQty,
        name: m.name,
        perPurchasePrice: impliedUnit,
        packSize: packSize ?? undefined,
      });
      if (sane !== null && sane < count) count = sane;
      m.quantity = count;
      if (r.purchaseUnit) m.unit = r.purchaseUnit;
      if (impliedUnit > 0) {
        m.price = round2(impliedUnit);
        m.totalPrice = round2(m.price * count);
        m.priceStatus = 'priced';
      }
      if (chosen) {
        m.chosen = {
          name: chosen.name,
          price: impliedUnit > 0 ? round2(impliedUnit) : chosen.price,
          confidence: r.confidence,
          pack: packSize && chosen.packUnit ? { packSize, packUnit: chosen.packUnit } : m.chosen?.pack,
        };
      }
      m.reconcile = { decision: 'apply', confidence: r.confidence, note: r.coverageNote || r.reasoning };
      return m;
    }
    return m;
  });
}

export interface RescueDeps {
  /** Batch search by term — the replay's scraperBatch. */
  fetchCandidates: (terms: string[]) => Promise<Map<string, ReplayScraperCandidate[]>>;
  /** Run the reconcile LLM over rescue items and return its decisions. */
  reconcile: (items: ReconcileItem[]) => Promise<ReconcileDecision[]>;
  /** Deterministic last-resort unit price; null = leave the row at $0. */
  fallbackUnitPrice?: (row: ReplayPricedRow) => number | null;
}

export interface RescueMeta {
  rejected: number;
  retried: number;
  rescued: number;
  estimatedFallback: number;
  stillUnpriced: number;
}

/**
 * Rejected-row rescue — mirrors production's materialsPipeline pass: rows the
 * reconcile pass rejected get one retry with a category-level simplified
 * search term (re-reconciled so the category gate still guards the new
 * candidates), then a visible deterministic estimate rather than a $0 row.
 */
export async function rescueRejectedRows(
  rows: ReplayPricedRow[],
  deps: RescueDeps
): Promise<{ rows: ReplayPricedRow[]; meta: RescueMeta }> {
  const meta: RescueMeta = { rejected: 0, retried: 0, rescued: 0, estimatedFallback: 0, stillUnpriced: 0 };
  const rejectedIdx = rows
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.priceStatus === 'rejected');
  meta.rejected = rejectedIdx.length;
  let out = rows;

  const termByIdx = new Map<number, string>();
  for (const { m, i } of rejectedIdx) {
    const simplified = simplifySearchTerm(m.searchTerm || m.name);
    if (simplified) termByIdx.set(i, simplified);
  }

  if (termByIdx.size > 0) {
    const cands = await deps.fetchCandidates([...new Set(termByIdx.values())]);
    const items: ReconcileItem[] = [];
    const candidatesById = new Map<string, ReconcileItemCandidate[]>();
    for (const [i, term] of termByIdx) {
      const m = rows[i];
      // Gate against the ORIGINAL name — the simplified term dropped specs
      // to broaden the search, but specs still decide what's acceptable.
      const found = (cands.get(term) || []).filter((c) =>
        isSemanticallyCompatible(m.name, c.productName || '')
      );
      if (found.length === 0) continue;
      const id = `row-${i}`;
      const mapped = found.slice(0, 5).map((c) => {
        const parsed = parsePackInfo(c.productName);
        return {
          name: c.productName,
          price: c.priceIncGst || c.price,
          url: c.productUrl,
          description: c.description,
          packSize: c.packSize ?? parsed?.packSize,
          packUnit: c.packUnit ?? parsed?.packUnit,
        };
      });
      items.push({
        id,
        name: term,
        requirement: m.requiredQty ?? m.quantity,
        requirementUnit: m.requiredUnit ?? m.chosen?.pack?.packUnit ?? m.unit,
        candidates: mapped,
      });
      candidatesById.set(id, mapped);
    }
    if (items.length > 0) {
      meta.retried = items.length;
      const decisions = await deps.reconcile(items);
      out = applyReconcileDecisions(rows, decisions, candidatesById);
      for (const [i, term] of termByIdx) {
        const m = out[i];
        if (m.priceStatus !== 'rejected' && m.price > 0 && m.reconcile) {
          m.searchTerm = term;
          meta.rescued++;
        }
      }
    }
  }

  // Safety net: still-$0 rejected rows get a visible deterministic estimate.
  for (const { i } of rejectedIdx) {
    const m = out[i];
    if (m.price > 0) continue;
    const fallback = deps.fallbackUnitPrice?.(m);
    if (fallback && fallback > 0) {
      m.price = fallback;
      m.totalPrice = round2(fallback * m.quantity);
      m.priceStatus = 'estimated-fallback';
      meta.estimatedFallback++;
    } else {
      meta.stillUnpriced++;
    }
  }
  return { rows: out, meta };
}

/**
 * Final deterministic coverage sweep — mirrors the post-reconcile sweep in
 * materialsPipeline: clamp bulk fastener/liquid over-buys and area-derived
 * board over-counts DOWN. Mutates rows in place and returns them.
 */
export function finalCoverageSweep(rows: ReplayPricedRow[], jobDescription?: string): ReplayPricedRow[] {
  const jobAreaM2 = parseJobAreaM2(jobDescription)?.areaM2 ?? null;
  for (const m of rows) {
    if (m.requiredQty === undefined || !(m.price > 0)) continue;
    const sane = coverageSanePurchaseCount({
      requirement: m.requiredQty,
      name: m.name,
      perPurchasePrice: m.price,
      packSize: m.chosen?.pack?.packSize,
    });
    if (sane !== null && sane < m.quantity) {
      m.quantity = sane;
      m.totalPrice = round2(m.price * sane);
    }
    if (jobAreaM2 !== null) {
      const geoMax = geometricSanePieceCount({
        name: m.name,
        requirement: m.requiredQty,
        areaM2: jobAreaM2,
      });
      if (geoMax !== null && geoMax < m.quantity) {
        m.quantity = geoMax;
        m.totalPrice = round2(m.price * geoMax);
      }
    }
  }
  return rows;
}
