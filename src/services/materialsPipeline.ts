// Materials pipeline — orchestrates the "Get Recommended Gear" step previously
// glued to MaterialsListScreen. Pulled out so:
//   1. The wizard can call it via the manual tap path.
//   2. Mate's apply path can call it inline from chat and stream progress
//      events into a working-card bubble.
//
// Phase 1 (this commit): just the analyse step — generates materials from a
// job description and turns them into Material[] + QuoteSection[].
// Phase 2 (planned): the price-fetch + reconcile orchestrator currently
// living in handleFetchPrices.

import {
  BusinessSettings,
  FavoriteProductMapping,
  Material,
  Quote,
  QuoteSection,
  SectionTemplate,
} from '../types';
import { generateId } from '../utils/generateId';
import { needsPriceFetch } from '../utils/priceFetchGate';
import { buildTradeContext } from '../utils/buildTradeContext';
import { supplierPriceForGstMode, roundToTwoDecimals } from '../utils/quoteCalculator';
import { keepSupplierPriceInclusive } from '../../shared/document';
import { applyPackAwarePricing } from '../utils/packAwarePricing';
import { parsePackInfo } from '../utils/parsePackInfo';
import { coverageSanePurchaseCount, coverageFloorPurchaseCount, recoverPackInfo } from '../utils/purchaseCoverage';
import {
  parseJobAreaM2,
  geometricSanePieceCount,
  geometricMinimumPieceCount,
} from '../utils/geometricCoverage';
import {
  analyzeJobDescription,
  convertLLMMaterialsToMaterials,
  reconcilePricedMaterials,
  type ReconcileResult,
} from './llmService';
import { simplifySearchTerm } from '../utils/simplifySearchTerm';
import { withPreservedCorrections } from './floorplanTakeoff';
import { stampAsPriced } from '../utils/asPriced';
import { isNonRetailTradeRow, tradeFallbackUnitPrice } from '../utils/tradeFallback';
import { loadAllFavoritesForLLM, loadFavoritesFromLocal } from './materialFavorites';
import { searchLocalSources } from './localMaterialSearch';
import { loadGroups as loadSupplierGroups } from './supplierGroupService';
import {
  searchReeceMaterialCandidates,
  getReeceConnectionStatus,
} from './reeceApi';
import { shouldRunReeceFirst } from './supplierPriority';
import {
  batchFindBestMatchesProgressive,
  findCandidatesForMaterial,
  type ScraperProduct,
} from './bunningsScraperClient';
import { searchMaterialPrice } from './webSearchPricing';
import { pickBestCandidate, isSemanticallyCompatible, type RankableCandidate } from './candidateRanker';

// Identities this row must never match again (see Material.excludedProducts —
// written by the reprice wipe when a match kept returning implausible money).
const excludeSetFor = (m: Material): ReadonlySet<string> | undefined =>
  m.excludedProducts?.length ? new Set(m.excludedProducts) : undefined;

import { summarizePriceFetchOutcome } from './priceFetchTelemetry';
import { matchEvidence, stampMatchConfidence } from '../utils/matchEvidence';
import { withOrigin } from '../utils/materialOrigin';
import { withKeepAwake } from '../utils/withKeepAwake';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

// Re-exported so the price-fetch summary shape has a single documented home
// alongside the pipeline that produces it.
export { summarizePriceFetchOutcome } from './priceFetchTelemetry';

export interface PipelineEvent {
  phase: 'preflight' | 'analyzing' | 'building' | 'done';
  status: string;
  detail?: string;
}

export interface GenerateMaterialsArgs {
  quote: Quote;
  businessSettings: BusinessSettings | null;
  /** Whether the user is on a Pro plan — controls photo-vision input. */
  isPro: boolean;
  /** All saved section templates available to the trader. */
  templates: SectionTemplate[];
}

export interface GenerateMaterialsCallbacks {
  onEvent?: (event: PipelineEvent) => void;
  /** Polled at safe points so the caller can interrupt mid-pipeline. */
  shouldCancel?: () => boolean;
}

export interface GenerateMaterialsResult {
  /** The quote with materials + sections + estimatedHours populated. */
  updatedQuote: Quote;
  /** Materials added by this pass (excludes any pre-existing). */
  generatedMaterialCount: number;
  /** estimatedHours from the LLM (capped 1..200 by validateMaterials). */
  estimatedHours: number;
}

export class PipelineCancelled extends Error {
  constructor() {
    super('__PIPELINE_CANCELLED__');
    this.name = 'PipelineCancelled';
  }
}

/**
 * Run the analyse step: read the quote's job description, hand it to
 * analyzeJobDescription with the relevant context (trade, templates, saved
 * rates, photos), then build Material[] + QuoteSection[] from the result.
 *
 * Persistence (saveDraft) is left to the caller — this function is pure(-ish)
 * apart from the LLM + favourites reads.
 */
export function generateMaterialsForQuote(
  args: GenerateMaterialsArgs,
  callbacks: GenerateMaterialsCallbacks = {},
): Promise<GenerateMaterialsResult> {
  // Held awake for the whole run — a sleeping phone drops the network and
  // kills the generation mid-flight (see withKeepAwake).
  return withKeepAwake(() => generateMaterialsForQuoteInner(args, callbacks));
}

async function generateMaterialsForQuoteInner(
  args: GenerateMaterialsArgs,
  callbacks: GenerateMaterialsCallbacks = {},
): Promise<GenerateMaterialsResult> {
  const { quote, businessSettings, isPro, templates } = args;
  const { onEvent, shouldCancel } = callbacks;

  if (!quote.job?.description) {
    throw new Error('Quote has no job description — add a scope first.');
  }

  onEvent?.({ phase: 'preflight', status: 'Pulling your trade defaults and saved rates…' });

  const tradeContext = buildTradeContext(businessSettings);

  const photoUrlsForAi: string[] | undefined = (() => {
    const photos = (quote as any).photos;
    if (!isPro || !photos?.length) return undefined;
    const urls = photos.map((p: any) => p.storageUrl).filter(Boolean);
    return urls.length > 0 ? urls : undefined;
  })();

  // Existing materials are passed so the LLM doesn't duplicate them
  // (gap-fill mode). requiredQty + packUnit reveal the underlying need
  // when prior pricing collapsed it into packs.
  const existingMatsForAi = quote.materials.length > 0
    ? quote.materials.map((m) => ({
        name: m.name,
        quantity: m.requiredQty ?? m.quantity,
        unit: (m.packUnit ?? m.unit) as Material['unit'],
        section: m.section,
      }))
    : undefined;

  const templateDataForAi = templates.length > 0
    ? templates.map((t) => ({
        name: t.name,
        materials: t.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
        laborHours: t.laborHours,
      }))
    : undefined;

  const savedRateFavorites = await loadAllFavoritesForLLM();
  const userSavedRatesForAi = savedRateFavorites.length > 0
    ? savedRateFavorites
        .filter((f) => typeof f.price === 'number' && f.price > 0 && f.unit)
        .map((f) => ({
          name: f.productName,
          store: f.store,
          unit: f.unit as string,
          price: f.price as number,
          coveragePerUnit: f.coveragePerUnit,
          coverageUnit: f.coverageUnit,
          keywords: f.keywords,
          notes: f.notes,
        }))
    : [];

  if (shouldCancel?.()) throw new PipelineCancelled();

  onEvent?.({ phase: 'analyzing', status: 'Reading the scope and drafting the gear list…' });

  const analysis = await analyzeJobDescription(
    quote.job.description,
    tradeContext,
    photoUrlsForAi,
    existingMatsForAi,
    templateDataForAi,
    userSavedRatesForAi,
  );

  if (shouldCancel?.()) throw new PipelineCancelled();

  onEvent?.({
    phase: 'building',
    status: `Got ${analysis.materials.length} items — sorting into sections…`,
    detail: analysis.materials.slice(0, 5).map((m) => m.name).join(', '),
  });

  const baseMaterials = convertLLMMaterialsToMaterials(analysis.materials);

  // Build a name -> favourite map so saved supplier rates win over $0.
  const localFavoritesById = await loadFavoritesFromLocal();
  const savedRateByName = new Map<string, FavoriteProductMapping>();
  Object.values(localFavoritesById).forEach((f) => {
    if (f.isPersonalRate && f.productName) {
      savedRateByName.set(f.productName.toLowerCase().trim(), f);
    }
  });

  const generatedMaterials: Material[] = baseMaterials.map((m) => {
    const matchedRate = m.savedRateName
      ? savedRateByName.get(m.savedRateName.toLowerCase().trim())
      : undefined;
    const baseQty = m.quantity || 1;

    if (matchedRate && typeof matchedRate.price === 'number' && matchedRate.price > 0) {
      return withOrigin({
        id: generateId(),
        name: m.name || matchedRate.productName,
        quantity: baseQty,
        unit: (matchedRate.unit || m.unit || 'each') as Material['unit'],
        searchTerm: m.searchTerm,
        price: matchedRate.price,
        totalPrice: matchedRate.price * baseQty,
        manualPriceOverride: false,
        pricingSource: 'manual',
        priceConfidence: 'high',
        favoriteProduct: matchedRate,
        ...(m.section ? { section: m.section } : {}),
        ...(m.templateBaseQuantity ? { templateBaseQuantity: m.templateBaseQuantity } : {}),
      } as Material, 'recommended');
    }
    return withOrigin({
      id: generateId(),
      name: m.name || 'Unknown Material',
      quantity: baseQty,
      unit: (m.unit || 'each') as Material['unit'],
      searchTerm: m.searchTerm,
      price: 0,
      totalPrice: 0,
      manualPriceOverride: false,
      ...(m.section ? { section: m.section } : {}),
      ...(m.templateBaseQuantity ? { templateBaseQuantity: m.templateBaseQuantity } : {}),
    } as Material, 'recommended');
  });

  // Sections: collect distinct multipliers per section (trust only when
  // unanimous — see the long-form comment in the original handler about why
  // we fall back to MIN on disagreement, not MAX).
  const sectionMultiplierCandidates = new Map<string, Set<number>>();
  const sectionLaborHours = new Map<string, number>();
  baseMaterials.forEach((m) => {
    if (m.section) {
      const candidate = m.sectionMultiplier && m.sectionMultiplier > 0 ? m.sectionMultiplier : 1;
      const set = sectionMultiplierCandidates.get(m.section) || new Set<number>();
      set.add(candidate);
      sectionMultiplierCandidates.set(m.section, set);
    }
    if (m.section && m.sectionLaborHours && m.sectionLaborHours > 0) {
      sectionLaborHours.set(m.section, m.sectionLaborHours);
    }
  });
  const sectionMultipliers = new Map<string, number>();
  sectionMultiplierCandidates.forEach((set, name) => {
    sectionMultipliers.set(name, Math.min(...Array.from(set)));
  });

  const existingSections = quote.sections || [];
  const existingSectionNames = new Set(existingSections.map((s) => s.name));
  const defaultRate = businessSettings?.defaultLaborRate || 85;
  const totalMultipliers = Array.from(sectionMultipliers.values()).reduce((a, b) => a + b, 0);
  const fallbackPerUnitHours = totalMultipliers > 0
    ? (analysis.estimatedHours || 8) / totalMultipliers
    : 1;

  const newSections: QuoteSection[] = [];
  sectionMultipliers.forEach((multiplier, sectionName) => {
    if (existingSectionNames.has(sectionName)) return;
    const perUnitHours = sectionLaborHours.get(sectionName) || fallbackPerUnitHours;
    // Always emit canonical hours at the business's hourly rate. This used to
    // draft long sections in days (value / 8, rate × 8), which left one quote
    // holding two unit systems at once — the labour editor then had to guess
    // which one it was reading and sometimes multiplied a day rate by 8 again.
    // Days are a display choice now; see shared/document/labourUnits.ts.
    newSections.push({
      id: `section-${Date.now()}-${sectionName.replace(/\s/g, '')}`,
      name: sectionName,
      multiplier,
      laborHours: perUnitHours,
      laborHoursTotal: Math.round(perUnitHours * multiplier * 100) / 100,
      laborRate: defaultRate,
      laborUnit: 'hours',
      laborTotal: perUnitHours * defaultRate * multiplier,
      sortOrder: existingSections.length + newSections.length,
    });
  });

  const hasExistingMaterials = quote.materials.length > 0;
  const updatedQuote: Quote = {
    ...quote,
    job: {
      ...quote.job,
      estimatedHours: analysis.estimatedHours,
      ...(analysis.floorplanAnalysis
        ? {
            floorplanAnalysis: withPreservedCorrections(
              analysis.floorplanAnalysis,
              quote.job?.floorplanAnalysis,
            ),
          }
        : {}),
    } as Quote['job'],
    sections: [...existingSections, ...newSections],
    materials: hasExistingMaterials ? [...quote.materials, ...generatedMaterials] : generatedMaterials,
    laborHours: hasExistingMaterials
      ? quote.laborHours + (analysis.estimatedHours || 0)
      : analysis.estimatedHours,
  };

  onEvent?.({
    phase: 'done',
    status: `Drafted ${generatedMaterials.length} item${generatedMaterials.length === 1 ? '' : 's'} across ${newSections.length || 1} section${newSections.length === 1 ? '' : 's'}.`,
  });

  return {
    updatedQuote,
    generatedMaterialCount: generatedMaterials.length,
    estimatedHours: analysis.estimatedHours,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: price fetch + reconciliation pipeline.
//
// Extracted from MaterialsListScreen.handleFetchPrices. Drives the same flow:
//   1. Local sources preflight (saved supplier-rate favourites)
//   2. Reece pre-pass when the user has placed Reece above Bunnings
//   3. Bunnings batch fetch in chunks of 3, applying products as chunks arrive
//   4. Reece post-pass for items Bunnings missed
//   5. Per-item individual fallback (uses batch cache, then individual scraper,
//      then AI estimate)
//   6. LLM reconciliation pass — picks the best candidate per material, or
//      rejects/estimates when no candidate fits.
// The legacy `searchMaterialWithWebScraping` branch was dead code (gated on
// useScraperApi = false, which is hardcoded true) so it's not carried across.

export type PricingPhase =
  | 'preflight'
  | 'local'
  | 'reece-pre'
  | 'batch'
  | 'reece-post'
  | 'individual'
  | 'reconcile'
  | 'done'
  | 'failed';

export type PricingEvent =
  | { kind: 'phase-start'; phase: PricingPhase; status: string }
  | {
      kind: 'item-priced';
      phase: PricingPhase;
      materialId: string;
      name: string;
      success: boolean;
      progress?: { current: number; total: number };
      /** Cloned snapshot of the row as just priced (price, qty, product
       *  metadata). Present on success so callers can render the real price
       *  the moment it lands instead of $0 until the pipeline finishes. */
      material?: Material;
    }
  | {
      kind: 'batch-chunk';
      chunkIndex: number;
      totalChunks: number;
      termStatuses: Map<string, 'pending' | 'searching' | 'done' | 'failed'>;
      /** Per-item display names + statuses, in remainingTerms order. Lets
       *  the chat working card show WHICH materials Mate is searching for
       *  right now instead of a bare "batch X of Y" line. */
      items: Array<{ name: string; status: 'pending' | 'searching' | 'done' | 'failed' }>;
      progress: { current: number; total: number };
      currentName?: string;
    }
  | { kind: 'reece-reauth' }
  | { kind: 'reconcile-start' }
  | {
      // Emitted when a local supplier is ranked above Bunnings in
      // BusinessSettings.supplierPriority but the local pass had no hit
      // for one or more terms — Bunnings ended up filling them. Lets the
      // UI / Mate tell the tradie their priority preference couldn't be
      // honoured for those rows so they know to expand their saved list.
      kind: 'supplier-priority-fallback';
      missedTerms: string[];
    }
  | {
      kind: 'complete';
      fetched: number;
      failed: number;
      skipped: number;
      cancelled: boolean;
    };

export interface FetchPricesArgs {
  quote: Quote;
  businessSettings: BusinessSettings | null;
  /**
   * Whether Reece is connected. Pass `null` to have the pipeline resolve it on
   * demand (one extra round-trip to getReeceConnectionStatus).
   */
  reeceConnected: boolean | null;
}

export interface FetchPricesCallbacks {
  onEvent?: (event: PricingEvent) => void;
  shouldCancel?: () => boolean;
}

export interface FetchPricesResult {
  updatedQuote: Quote;
  fetchedCount: number;
  failedCount: number;
  skippedCount: number;
  cancelled: boolean;
  reeceReauthNeeded: boolean;
}

class FetchCancelled extends Error {
  constructor() {
    super('__FETCH_CANCELLED__');
    this.name = 'FetchCancelled';
  }
}

function deterministicFallbackUnitPrice(material: Material): number | null {
  return tradeFallbackUnitPrice(`${material.searchTerm || ''} ${material.name || ''}`, material.unit);
}

function shouldUseTradeFallbackInsteadOfRetail(material: Material): boolean {
  return isNonRetailTradeRow(
    `${material.searchTerm || ''} ${material.name || ''}`,
    material.unit,
    material.requiredQty ?? material.quantity,
  );
}



type ReconcileOutcome = 'applied' | 'estimated' | 'rejected' | 'skipped';

/**
 * Apply one reconcile decision to a material — shared by the first reconcile
 * pass and the rejected-row rescue pass so both apply identical semantics
 * (candidate enrichment, coverage floor against under-buys, over-buy clamp,
 * 2dp unit price with derived line total).
 *
 * Exported for tests — this is where an under-buy is caught or missed, so it
 * needs coverage independent of the network-bound pipeline around it.
 */
export function applyReconcileResult(
  m: Material,
  r: ReconcileResult,
  cands: ScraperProduct[],
  gstInclusive: boolean,
): ReconcileOutcome {
  if (r.decision === 'reject') {
    m.price = 0;
    m.totalPrice = 0;
    m.priceConfidence = 'low';
    m.description = r.rejectReason || 'Product mismatch — verify before sending';
    return 'rejected';
  }
  if (
    r.decision === 'estimate' &&
    typeof r.estimatedUnitPrice === 'number' &&
    r.estimatedUnitPrice > 0 &&
    typeof r.purchaseCount === 'number' &&
    r.purchaseCount > 0
  ) {
    if (m.requiredQty === undefined) m.requiredQty = m.quantity;
    // Capture the requirement's own unit before `m.unit` is overwritten with a
    // purchase unit below — a second reconcile pass (rescueRejectedRows) would
    // otherwise compare the coverage guards against 'pack' instead of 'kg'.
    if (m.requiredUnit === undefined) m.requiredUnit = m.unit;
    // No candidate matched, so there is no scraped pack size — recover one from
    // the row and from the model's own coverage note, as the apply branch does.
    const { packSize: estPackSize, packUnit: estPackUnit } = recoverPackInfo(
      {
        rowPackSize: m.packSize,
        rowPackUnit: m.packUnit,
        rowDescription: r.coverageNote || r.reasoning,
        rowName: m.name,
      },
      parsePackInfo,
    );
    let estPurchaseCount = r.purchaseCount;
    // Coverage FLOOR against under-buys. This branch only ever ran the
    // over-buy clamp below, so an ESTIMATED row could be under-bought by any
    // factor with nothing to catch it — the same gap that let the apply branch
    // ship half the concrete on QU-178692, just one decision-type over.
    const estFloor = coverageFloorPurchaseCount({
      requirement: m.requiredQty,
      correctedRequirement: r.correctedRequirement,
      name: m.name,
      requirementUnit: m.requiredUnit,
      packSize: estPackSize,
      packUnit: estPackUnit,
    });
    if (estFloor !== null && estFloor > estPurchaseCount) estPurchaseCount = estFloor;
    // Over-buy clamp. Deliberately NOT given the recovered pack size: without a
    // matched candidate that size can come from model prose, and this guard's
    // price-based assumptions are what QU-178011 relies on. Floor raises on
    // recovered evidence; the clamp keeps its own.
    const estSane = coverageSanePurchaseCount({
      requirement: m.requiredQty,
      name: m.name,
      perPurchasePrice: r.estimatedUnitPrice,
    });
    if (estSane !== null && estSane < estPurchaseCount) estPurchaseCount = estSane;
    m.quantity = estPurchaseCount;
    if (r.purchaseUnit) m.unit = r.purchaseUnit as Material['unit'];
    // Unit price is the source of truth at 2dp; derive the line total
    // from it so quantity × price === totalPrice always holds. (Stop
    // trusting the LLM's r.totalPrice, which drifts from the unit price.)
    const estimatedUnit = roundToTwoDecimals(supplierPriceForGstMode(r.estimatedUnitPrice, gstInclusive));
    m.price = estimatedUnit;
    m.totalPrice = roundToTwoDecimals(estimatedUnit * estPurchaseCount);
    m.priceConfidence = 'low';
    m.pricingSource = 'ai';
    m.description = r.coverageNote || r.reasoning || 'Estimated — verify with supplier';
    m.bunningsItemNumber = undefined;
    m.productUrl = undefined;
    m.imageUrl = undefined;
    m.brand = undefined;
    m.stockCheckedAt = undefined;
    return 'estimated';
  }
  if (r.decision === 'apply' && typeof r.purchaseCount === 'number' && r.purchaseCount > 0) {
    const idx = typeof r.chosenIndex === 'number' ? r.chosenIndex : 0;
    const chosen = cands[idx];
    if (chosen) {
      if (chosen.itemNumber) {
        if (m.pricingSource === 'api') {
          m.reeceItemNumber = chosen.itemNumber;
        } else {
          m.bunningsItemNumber = chosen.itemNumber;
        }
      }
      if (chosen.productUrl) m.productUrl = chosen.productUrl;
      if (chosen.imageUrl) m.imageUrl = chosen.imageUrl;
      if (chosen.description) m.description = chosen.description;
      if (
        chosen.brand &&
        chosen.brand.toLowerCase() !== 'bunnings' &&
        chosen.brand.toLowerCase() !== 'bunnings.com.au' &&
        chosen.brand.toLowerCase() !== 'reece'
      ) {
        m.brand = chosen.brand;
      }
      if (chosen.stockCheckedAt) m.stockCheckedAt = chosen.stockCheckedAt;
    }
    if (m.requiredQty === undefined) m.requiredQty = m.quantity;
    // As in the estimate branch: pin the requirement's unit before `m.unit`
    // becomes a purchase unit, so a rescue pass still compares against 'kg'.
    if (m.requiredUnit === undefined) m.requiredUnit = m.unit;
    const originalCount = r.purchaseCount;
    // Per-purchase price: prefer the chosen candidate's real shelf price,
    // else the LLM's implied unit price (its total ÷ its count).
    const candidatePrice = chosen && chosen.price > 0 ? chosen.price : 0;
    const impliedUnitInc =
      candidatePrice > 0
        ? candidatePrice
        : typeof r.totalPrice === 'number' && r.totalPrice > 0
          ? r.totalPrice / originalCount
          : 0;
    // Deterministic coverage guard against bulk fastener/oil over-buys
    // (e.g. 19 tubs of decking screws when 1 covers a 10 m² deck). Uses
    // the candidate's real pack size when known, else a conservative
    // bulk assumption for high-priced fastener/liquid rows only.
    // Without a pack size the coverage FLOOR below returns null for any bulk
    // (kg/L/m) requirement, so the model's purchaseCount stands unchecked and a
    // row can be under-bought by any factor — see recoverPackInfo (QU-178692).
    const { packSize: candidatePackSize, packUnit: candidatePackUnit } = recoverPackInfo(
      {
        candidatePackSize: (chosen as { packSize?: number } | undefined)?.packSize,
        candidatePackUnit: (chosen as { packUnit?: string } | undefined)?.packUnit,
        candidateProductName: chosen?.productName,
        rowPackSize: m.packSize,
        rowPackUnit: m.packUnit,
        rowDescription: m.description,
        rowName: m.name,
      },
      parsePackInfo,
    );
    // Coverage FLOOR against reconcile under-buys: the LLM sometimes
    // returns a purchaseCount its own reasoning contradicts (3 posts
    // for a 7-post requirement). Raise to the minimum that covers the
    // requirement; honours the LLM's explicit requirement correction.
    const floor = coverageFloorPurchaseCount({
      requirement: m.requiredQty,
      correctedRequirement: r.correctedRequirement,
      name: m.name,
      requirementUnit: (m.requiredUnit ?? m.packUnit ?? m.unit) as string,
      packSize: candidatePackSize ?? undefined,
      packUnit: candidatePackUnit,
    });
    const flooredCount = floor !== null && floor > originalCount ? floor : originalCount;
    const sane = coverageSanePurchaseCount({
      requirement: m.requiredQty,
      name: m.name,
      perPurchasePrice: impliedUnitInc,
      packSize: candidatePackSize ?? undefined,
    });
    const purchaseCount = sane !== null && sane < flooredCount ? sane : flooredCount;
    m.quantity = purchaseCount;
    if (r.purchaseUnit) m.unit = r.purchaseUnit as Material['unit'];
    // Record the pack size when it actually explains the count, so the row
    // carries its own arithmetic ("20 kg/pack (need 440 kg)") the way the
    // pack-aware path's rows do. Without this a reconciled row shows a bare
    // quantity and there is no way — in the UI or on a re-price — to tell a
    // correct buy from an under-buy.
    if (
      candidatePackSize &&
      candidatePackUnit &&
      m.requiredQty &&
      Math.max(1, Math.ceil(m.requiredQty / candidatePackSize)) === purchaseCount
    ) {
      m.packSize = candidatePackSize;
      m.packUnit = candidatePackUnit as Material['unit'];
    }
    // Establish a 2dp unit price and derive the line total from it so
    // quantity × price === totalPrice always holds — this also kills the
    // float drift that printed $182.22 next to "96 × $1.90".
    if (impliedUnitInc > 0) {
      const unitPrice = roundToTwoDecimals(supplierPriceForGstMode(impliedUnitInc, gstInclusive));
      m.price = unitPrice;
      m.totalPrice = roundToTwoDecimals(unitPrice * purchaseCount);
    }
    if (r.confidence) m.priceConfidence = r.confidence;
    if (r.coverageNote) m.description = r.coverageNote;
    // The reconcile model is the category gate, and it is one non-deterministic
    // call: on QU-178711 it waved through a towel bar for a rebar row and
    // stamped it 'high'. Its confidence can never outrank what the two names
    // actually have in common.
    stampMatchConfidence(m, chosen?.productName);
    return 'applied';
  }
  return 'skipped';
}

function applyVisibleFallbackEstimate(material: Material, gstInclusive: boolean): boolean {
  const fallback = deterministicFallbackUnitPrice(material);
  if (!(fallback && fallback > 0)) return false;
  const unitPrice = roundToTwoDecimals(supplierPriceForGstMode(fallback, gstInclusive));
  material.price = unitPrice;
  material.totalPrice = roundToTwoDecimals(unitPrice * material.quantity);
  material.manualPriceOverride = false;
  material.pricingSource = 'ai';
  material.priceConfidence = 'low';
  material.description = 'Fallback trade estimate — supplier search skipped/returned no reliable retail match; verify before sending';
  material.bunningsItemNumber = undefined;
  material.productUrl = undefined;
  material.imageUrl = undefined;
  return true;
}

export function fetchPricesForQuote(
  args: FetchPricesArgs,
  callbacks: FetchPricesCallbacks = {},
): Promise<FetchPricesResult> {
  // Same wake guard as generateMaterialsForQuote — price fetches routinely
  // run past the screen-sleep timeout.
  return withKeepAwake(() => fetchPricesForQuoteInner(args, callbacks));
}

async function fetchPricesForQuoteInner(
  args: FetchPricesArgs,
  callbacks: FetchPricesCallbacks = {},
): Promise<FetchPricesResult> {
  const { quote, businessSettings } = args;
  const { onEvent, shouldCancel } = callbacks;

  // "Keep supplier prices inc-GST" applies in inclusive mode AND when the
  // business isn't GST-registered — a non-registered tradie pays GST on
  // materials and can't claim it back, so stripping 1/11 would under-price
  // every line. Only exclusive mode divides by 1.1.
  const gstInclusive = keepSupplierPriceInclusive(quote);
  const updatedMaterials: Material[] = quote.materials.map((m) => ({ ...m }));
  // Job-level quality tier inferred at analysis time. Inherited by any
  // material that doesn't carry its own tier. See candidateRanker for the
  // ranking math — the short version: "premium" pushes selection toward the
  // high end of the supplier search results instead of just hits[0].
  const jobQualityTier = quote.qualityTier;

  const checkCancel = () => {
    if (shouldCancel?.()) throw new FetchCancelled();
  };

  // Set of materials that need pricing. Priced rows are never re-fetched —
  // locked or not — so saved personal rates and hand-typed prices survive a
  // "Get Prices" run (rows wanting a re-price are zeroed beforehand).
  const materialsToFetch = updatedMaterials.filter(needsPriceFetch);

  if (materialsToFetch.length === 0) {
    onEvent?.({ kind: 'complete', fetched: 0, failed: 0, skipped: updatedMaterials.length, cancelled: false });
    return {
      updatedQuote: { ...quote, materials: updatedMaterials },
      fetchedCount: 0,
      failedCount: 0,
      skippedCount: updatedMaterials.length,
      cancelled: false,
      reeceReauthNeeded: false,
    };
  }

  let fetchedCount = 0;
  let skippedCount = updatedMaterials.length - materialsToFetch.length;
  let failedCount = 0;
  let reeceReauthNeeded = false;
  let cancelled = false;

  // Reece connection state. If the caller didn't know, resolve it now.
  onEvent?.({ kind: 'phase-start', phase: 'preflight', status: 'Warming up the ute…' });
  let liveReeceConnected = args.reeceConnected;
  if (liveReeceConnected === null) {
    try {
      const status = await getReeceConnectionStatus();
      liveReeceConnected = !!status.connected;
    } catch {
      liveReeceConnected = false;
    }
  }
  const useReeceApi = liveReeceConnected === true;
  const reeceFirst = useReeceApi && shouldRunReeceFirst(businessSettings?.supplierPriority);

  // Candidates surfaced during any pass — fed to reconciliation at the end.
  const candidatesByMaterialId = new Map<string, ScraperProduct[]>();
  // Tracks which terms the Bunnings batch returned a usable price for, so
  // when later chunks fire their callback we can correctly mark earlier
  // chunks' statuses. Declared up here so the batch callback closure can
  // see it before the callback first runs.
  const batchSucceededTerms = new Set<string>();

  // ── Local source preflight ──
  onEvent?.({ kind: 'phase-start', phase: 'local', status: 'Checking your saved supplier rates…' });
  const locallyPricedTerms = new Set<string>();
  // Track terms that hit the local pass with a miss while the user has a
  // local supplier ranked above Bunnings in BusinessSettings.supplierPriority
  // — surfaces the "we wanted to use your supplier but had to fall back to
  // Bunnings" gap to the caller so the UI / Mate can flag it instead of
  // silently substituting Bunnings prices.
  const localSupplierPreferredMisses = new Set<string>();
  try {
    const supplierList = await loadSupplierGroups();
    const priorityOrder = businessSettings?.supplierPriority ?? [];
    const bunningsIdx = priorityOrder.indexOf('bunnings');
    const localSupplierIds = new Set(supplierList.map((g) => g.id).filter(Boolean));
    const localRankedAboveBunnings = priorityOrder.some(
      (id, idx) => localSupplierIds.has(id) && (bunningsIdx === -1 || idx < bunningsIdx),
    );
    for (let i = 0; i < updatedMaterials.length; i++) {
      checkCancel();
      const m = updatedMaterials[i];
      if (!needsPriceFetch(m)) continue;
      const term = m.searchTerm || m.name;
      let hits: { price: number; productName?: string; productUrl?: string; imageUrl?: string; unit?: string }[] = [];
      try {
        hits = await searchLocalSources(term, supplierList, { priorityOrder });
      } catch {
        hits = [];
      }
      if (hits.length === 0) {
        if (localRankedAboveBunnings) localSupplierPreferredMisses.add(term);
        continue;
      }
      // Use the ranker to pick the best hit instead of just hits[0]. The
      // saved-supplier-rate path is usually 1–2 hits so the ranker mostly
      // no-ops here, but keeping the API consistent across paths means
      // future saved-rate libraries that return more candidates benefit
      // automatically.
      const ranked = pickBestCandidate(hits as RankableCandidate[], {
        name: m.name,
        searchTerm: m.searchTerm,
        qualityTier: m.qualityTier,
      }, { jobQualityTier, excludeProducts: excludeSetFor(m) }) as (typeof hits[number]) | null;
      const top = ranked || hits[0];
      m.price = supplierPriceForGstMode(top.price, gstInclusive);
      m.manualPriceOverride = false;
      m.pricingSource = 'manual';
      if (top.productUrl) m.productUrl = top.productUrl;
      if (top.imageUrl) m.imageUrl = top.imageUrl;
      if (top.unit) m.unit = top.unit as Material['unit'];
      applyPackAwarePricing(m, { productName: top.productName });
      fetchedCount += 1;
      locallyPricedTerms.add(term);
      onEvent?.({
        kind: 'item-priced',
        phase: 'local',
        materialId: m.id,
        name: m.name,
        success: true,
        progress: { current: fetchedCount, total: materialsToFetch.length },
        material: { ...m },
      });
    }
  } catch {
    // Best-effort — fall through.
  }

  // If the user ranked a local supplier above Bunnings but the local pass
  // didn't find prices for some terms, emit a single info event so the
  // caller can surface it (e.g. Mate mentions 'Bunnings filled X items
  // your supplier list didn't cover').
  if (localSupplierPreferredMisses.size > 0) {
    onEvent?.({
      kind: 'supplier-priority-fallback',
      missedTerms: Array.from(localSupplierPreferredMisses),
    });
  }

  // Force visible fallback estimates for known non-retail/trade-service rows.
  // These should not hit Bunnings/Reece at all unless the user has an explicit
  // saved/manual supplier rate (handled above). Quality > false precision.
  //
  // Routing is unconditional: even when the price table has no entry, the row
  // is excluded from retail search — falling through once matched a 20m³
  // ready-mix concrete row to a "concrete umbrella base". Table-less rows go
  // to the general-knowledge estimate in the individual pass instead.
  const forcedFallbackTerms = new Set<string>();
  const nonRetailRowIds = new Set<string>();
  for (const m of updatedMaterials) {
    checkCancel();
    if (!needsPriceFetch(m)) continue;
    if (!shouldUseTradeFallbackInsteadOfRetail(m)) continue;
    forcedFallbackTerms.add(m.searchTerm || m.name);
    nonRetailRowIds.add(m.id);
    if (applyVisibleFallbackEstimate(m, gstInclusive)) {
      fetchedCount += 1;
      onEvent?.({
        kind: 'item-priced',
        phase: 'individual',
        materialId: m.id,
        name: m.name,
        success: true,
        progress: { current: fetchedCount, total: materialsToFetch.length },
        material: { ...m },
      });
    }
  }

  const reecePricedTerms = new Set<string>();

  // Helper used by both Reece pre-pass and post-pass.
  const reecePass = async (
    eligibleTerms: Set<string> | null,
    overrideExisting: boolean,
  ): Promise<boolean> => {
    let reauth = false;
    for (let i = 0; i < updatedMaterials.length; i++) {
      checkCancel();
      const m = updatedMaterials[i];
      if (m.manualPriceOverride) continue;
      if (m.reeceItemNumber && m.pricingSource === 'api') continue;
      if (!overrideExisting && m.price > 0) continue;
      const term = m.searchTerm || m.name;
      if (locallyPricedTerms.has(term)) continue;
      if (reecePricedTerms.has(term)) continue;
      if (eligibleTerms && !eligibleTerms.has(term)) continue;

      let candidates;
      try {
        candidates = await searchReeceMaterialCandidates(term);
      } catch (err: any) {
        onEvent?.({
          kind: 'item-priced',
          phase: overrideExisting ? 'reece-pre' : 'reece-post',
          materialId: m.id,
          name: m.name,
          success: false,
        });
        continue;
      }
      if (candidates[0]?.reauthRequired) {
        reauth = true;
        break;
      }
      // Reece returns 1–5 candidates per term; pick the best fit for the
      // material's quality tier instead of defaulting to candidates[0].
      // Filter to fully-resolved candidates (price + itemNumber) first so
      // the ranker doesn't waste a slot on a reauth/notConnected sentinel.
      const validReeceCandidates = candidates.filter(
        (c) => typeof c.price === 'number' && c.price > 0 && !!c.itemNumber,
      );
      const result =
        pickBestCandidate(
          validReeceCandidates as unknown as RankableCandidate[],
          { name: m.name, searchTerm: m.searchTerm, qualityTier: m.qualityTier },
          { jobQualityTier, excludeProducts: excludeSetFor(m) },
        ) as unknown as (typeof candidates[number]) | null
        || candidates[0];
      if (!result || !result.price || !result.itemNumber) {
        onEvent?.({
          kind: 'item-priced',
          phase: overrideExisting ? 'reece-pre' : 'reece-post',
          materialId: m.id,
          name: m.name,
          success: false,
        });
        continue;
      }

      if (!m.searchTerm) m.searchTerm = m.name;
      candidatesByMaterialId.set(
        m.id,
        candidates
          .filter((c) => c.price != null && c.price > 0 && c.itemNumber)
          .map((c) => ({
            productName: c.productName || '',
            description: c.productName,
            price: c.price as number,
            priceIncGst: c.price as number,
            unit: c.unitOfMeasure || 'each',
            itemNumber: c.itemNumber as string,
            stockLevel: 'unknown' as const,
            productUrl: c.productUrl || '',
            imageUrl: c.imageUrl || undefined,
            confidence: 'medium' as const,
          })),
      );

      const reecePrice = supplierPriceForGstMode(result.price, gstInclusive);
      m.price = reecePrice;
      m.totalPrice = roundToTwoDecimals(reecePrice * m.quantity);
      m.manualPriceOverride = false;
      m.pricingSource = 'api';
      m.bunningsItemNumber = undefined;
      m.priceConfidence = undefined;
      m.reeceItemNumber = result.itemNumber;
      if (result.unitOfMeasure) m.reeceUnitOfMeasure = result.unitOfMeasure;
      if (result.productName) m.name = result.productName;
      if (result.store) m.description = `Available at ${result.store}`;
      if (result.imageUrl) m.imageUrl = result.imageUrl;
      if (result.productUrl) m.productUrl = result.productUrl;
      // This path deliberately falls back to candidates[0] when the ranker
      // refuses every hit, so the evidence check has to be applied to what
      // actually landed on the row rather than trusted to the pick.
      stampMatchConfidence(m, result.productName);
      fetchedCount += 1;
      reecePricedTerms.add(term);
      onEvent?.({
        kind: 'item-priced',
        phase: overrideExisting ? 'reece-pre' : 'reece-post',
        materialId: m.id,
        name: m.name,
        success: true,
        progress: { current: fetchedCount, total: materialsToFetch.length },
        material: { ...m },
      });
    }
    return reauth;
  };

  try {
    if (reeceFirst) {
      onEvent?.({ kind: 'phase-start', phase: 'reece-pre', status: 'Checking Reece (your preferred supplier)…' });
      const reauth = await reecePass(null, true);
      if (reauth) {
        reeceReauthNeeded = true;
        onEvent?.({ kind: 'reece-reauth' });
      }
    }

    // ── Bunnings batch fetch ──
    let batchResults: Map<string, ScraperProduct[]> | null = null;
    const remainingTerms = materialsToFetch
      .map((m) => m.searchTerm || m.name)
      .filter((term) => !locallyPricedTerms.has(term) && !reecePricedTerms.has(term) && !forcedFallbackTerms.has(term));

    if (remainingTerms.length > 0) {
      onEvent?.({
        kind: 'phase-start',
        phase: 'batch',
        status: `Checking Bunnings for ${remainingTerms.length} item${remainingTerms.length === 1 ? '' : 's'}…`,
      });
      try {
        const chunkSize = 3;
        const totalChunks = Math.ceil(remainingTerms.length / chunkSize);
        // Display-name lookup so the working card can show "Searching:
        // 75mm screws" instead of a bare search term. Falls back to the
        // search term itself if a material can't be matched.
        const termToDisplayName = new Map<string, string>();
        for (const term of remainingTerms) {
          const mat = updatedMaterials.find((m) => (m.searchTerm || m.name) === term);
          termToDisplayName.set(term, mat?.name || term);
        }
        const buildItemList = (
          statuses: Map<string, 'pending' | 'searching' | 'done' | 'failed'>,
        ) =>
          remainingTerms.map((term) => ({
            name: termToDisplayName.get(term) || term,
            status: statuses.get(term) || 'pending',
          }));
        const initialStatuses = new Map<string, 'pending' | 'searching' | 'done' | 'failed'>();
        remainingTerms.forEach((term, idx) => {
          initialStatuses.set(term, idx < chunkSize ? 'searching' : 'pending');
        });
        onEvent?.({
          kind: 'batch-chunk',
          chunkIndex: 0,
          totalChunks,
          termStatuses: new Map(initialStatuses),
          items: buildItemList(initialStatuses),
          progress: { current: 0, total: materialsToFetch.length },
          currentName: `Searching batch 1 of ${totalChunks}…`,
        });

        const applyProduct = (material: Material, product: ScraperProduct) => {
          material.price = product.price;
          material.manualPriceOverride = false;
          material.pricingSource = 'scraper';
          if (product.confidence) material.priceConfidence = product.confidence;
          if (product.itemNumber) material.bunningsItemNumber = product.itemNumber;
          if (product.productUrl) material.productUrl = product.productUrl;
          if (product.imageUrl) material.imageUrl = product.imageUrl;
          if (product.description) material.description = product.description;
          if (
            product.brand &&
            product.brand.toLowerCase() !== 'bunnings' &&
            product.brand.toLowerCase() !== 'bunnings.com.au'
          ) {
            material.brand = product.brand;
          }
          if (product.stockCheckedAt) material.stockCheckedAt = product.stockCheckedAt;
          applyPackAwarePricing(material, {
            productName: product.productName,
            packSize: (product as any).packSize,
            packUnit: (product as any).packUnit,
          });
          stampMatchConfidence(material, product.productName);
        };

        batchResults = await batchFindBestMatchesProgressive(
          remainingTerms,
          5,
          chunkSize,
          (chunkResults, _chunkTerms, chunkIndex) => {
            const statuses = new Map<string, 'pending' | 'searching' | 'done' | 'failed'>();
            // Mark previously-completed chunks as done/failed based on candidate results we've collected.
            // (We get the chunkResults map for THIS chunk only; rebuild statuses from scratch.)
            for (let j = 0; j < remainingTerms.length; j++) {
              const term = remainingTerms[j];
              const chunkOf = Math.floor(j / chunkSize);
              if (chunkOf < chunkIndex) {
                statuses.set(term, batchSucceededTerms.has(term) ? 'done' : 'failed');
              } else if (chunkOf === chunkIndex) {
                // resolved in THIS callback
                statuses.set(term, 'done'); // placeholder; corrected below
              } else if (chunkOf === chunkIndex + 1) {
                statuses.set(term, 'searching');
              } else {
                statuses.set(term, 'pending');
              }
            }

            for (const [searchTerm, candidates] of chunkResults) {
              const matIndex = updatedMaterials.findIndex(
                (m) => (m.searchTerm || m.name) === searchTerm,
              );
              if (matIndex === -1) continue;
              const material = updatedMaterials[matIndex];
              // Pick the best fit out of the (up to 5) scraper candidates
              // for this material's quality tier, instead of trusting the
              // scraper's default "most relevant" first hit — which on
              // Bunnings tends to be the cheapest/most-popular SKU. See
              // candidateRanker for the tier-bias math.
              const product =
                pickBestCandidate(candidates as RankableCandidate[], material, { jobQualityTier, excludeProducts: excludeSetFor(material) }) as ScraperProduct | null;
              if (candidates.length > 0) candidatesByMaterialId.set(material.id, candidates);
              const ok = !!(product && product.price > 0);
              if (ok && product) {
                applyProduct(material, product);
                fetchedCount += 1;
                batchSucceededTerms.add(searchTerm);
              }
              statuses.set(searchTerm, ok ? 'done' : 'failed');
              onEvent?.({
                kind: 'item-priced',
                phase: 'batch',
                materialId: material.id,
                name: material.name,
                success: ok,
                material: ok ? { ...material } : undefined,
              });
            }

            const completedCount = Math.min((chunkIndex + 1) * chunkSize, remainingTerms.length);
            onEvent?.({
              kind: 'batch-chunk',
              chunkIndex: chunkIndex + 1,
              totalChunks,
              termStatuses: statuses,
              items: buildItemList(statuses),
              progress: { current: completedCount, total: materialsToFetch.length },
              currentName:
                chunkIndex + 1 < totalChunks
                  ? `Searching batch ${chunkIndex + 2} of ${totalChunks}…`
                  : undefined,
            });
          },
          () => shouldCancel?.() === true,
        );
      } catch (err: any) {
        if (err instanceof FetchCancelled) throw err;
        batchResults = null;
      }
    }

    // ── Reece post-pass ──
    if (useReeceApi && !reeceFirst && !reeceReauthNeeded) {
      const unpriced = new Set<string>();
      for (const m of updatedMaterials) {
        if (!needsPriceFetch(m)) continue;
        unpriced.add(m.searchTerm || m.name);
      }
      if (unpriced.size > 0) {
        onEvent?.({ kind: 'phase-start', phase: 'reece-post', status: 'Checking Reece for the rest…' });
        const reauth = await reecePass(unpriced, false);
        if (reauth) {
          reeceReauthNeeded = true;
          onEvent?.({ kind: 'reece-reauth' });
        }
      }
    }

    // ── Per-item individual fallback ──
    const stillUnpriced = updatedMaterials.filter(needsPriceFetch);
    if (stillUnpriced.length > 0) {
      onEvent?.({
        kind: 'phase-start',
        phase: 'individual',
        status: `Hunting prices for ${stillUnpriced.length} item${stillUnpriced.length === 1 ? '' : 's'}…`,
      });
    }
    const hardwareStores = ['bunnings.com.au'];
    let fetchIndex = 0;
    for (let i = 0; i < updatedMaterials.length; i++) {
      checkCancel();
      const material = updatedMaterials[i];
      if (!needsPriceFetch(material)) continue;
      fetchIndex += 1;
      const searchTerm = material.searchTerm || material.name;

      try {
        // Non-retail rows (services, allowances, bulk supply) never get
        // retail candidates — an empty list drops them straight to the
        // general-knowledge estimate below.
        let candidates = nonRetailRowIds.has(material.id)
          ? []
          : batchResults?.get(searchTerm) ?? [];
        if (candidates.length === 0 && !nonRetailRowIds.has(material.id)) {
          candidates = await findCandidatesForMaterial(searchTerm);
        }
        if (candidates.length > 0) candidatesByMaterialId.set(material.id, candidates);
        // Tier-aware pick on the individual-fallback path too — same logic
        // as the batch path above. The supplier ranker put a budget SKU
        // first; we want the one that matches this material's quality tier.
        const product =
          pickBestCandidate(candidates as RankableCandidate[], material, { jobQualityTier, excludeProducts: excludeSetFor(material) }) as ScraperProduct | null;

        if (product && product.price > 0) {
          material.price = supplierPriceForGstMode(product.price, gstInclusive);
          material.manualPriceOverride = false;
          material.pricingSource = 'scraper';
          if (product.itemNumber) material.bunningsItemNumber = product.itemNumber;
          if (product.productUrl) material.productUrl = product.productUrl;
          if (product.imageUrl) material.imageUrl = product.imageUrl;
          if (product.description) material.description = product.description;
          if (
            product.brand &&
            product.brand.toLowerCase() !== 'bunnings' &&
            product.brand.toLowerCase() !== 'bunnings.com.au'
          ) {
            material.brand = product.brand;
          }
          if (product.stockCheckedAt) material.stockCheckedAt = product.stockCheckedAt;
          applyPackAwarePricing(material, {
            productName: product.productName,
            packSize: (product as any).packSize,
            packUnit: (product as any).packUnit,
          });
          stampMatchConfidence(material, product.productName);
          fetchedCount += 1;
          onEvent?.({
            kind: 'item-priced',
            phase: 'individual',
            materialId: material.id,
            name: material.name,
            success: true,
            progress: { current: fetchedCount, total: materialsToFetch.length },
            material: { ...material },
          });
          continue;
        }
        throw new Error('No product found with price');
      } catch (err: any) {
        if (err instanceof FetchCancelled) throw err;
        // Scraper missed — AI estimate fallback.
        try {
          const aiResult = await searchMaterialPrice(searchTerm, hardwareStores);
          if (aiResult.price) {
            material.price = supplierPriceForGstMode(aiResult.price, gstInclusive);
            material.manualPriceOverride = false;
            material.pricingSource = 'ai';
            material.priceConfidence = 'low';
            if (aiResult.productName) material.name = aiResult.productName;
            material.description = 'Estimated price — verify with supplier before sending';
            applyPackAwarePricing(material, { productName: aiResult.productName });
            fetchedCount += 1;
            onEvent?.({
              kind: 'item-priced',
              phase: 'individual',
              materialId: material.id,
              name: material.name,
              success: true,
              progress: { current: fetchedCount, total: materialsToFetch.length },
              material: { ...material },
            });
            continue;
          }
        } catch {
          // fall through to failed
        }
        const fallback = deterministicFallbackUnitPrice(material);
        if (fallback && fallback > 0) {
          const unitPrice = roundToTwoDecimals(supplierPriceForGstMode(fallback, gstInclusive));
          material.price = unitPrice;
          material.totalPrice = roundToTwoDecimals(unitPrice * material.quantity);
          material.manualPriceOverride = false;
          material.pricingSource = 'ai';
          material.priceConfidence = 'low';
          material.description = 'Fallback estimate — supplier search returned no reliable price; verify before sending';
          fetchedCount += 1;
          onEvent?.({
            kind: 'item-priced',
            phase: 'individual',
            materialId: material.id,
            name: material.name,
            success: true,
            progress: { current: fetchedCount, total: materialsToFetch.length },
            material: { ...material },
          });
          continue;
        }

        failedCount += 1;
        if (nonRetailRowIds.has(material.id)) {
          // Deliberately unpriced rather than mispriced: the tradie knows
          // their own service/supply rate better than any retail search.
          material.description = 'Not a retail item (service/supply) — add your price before sending';
        }
        onEvent?.({
          kind: 'item-priced',
          phase: 'individual',
          materialId: material.id,
          name: material.name,
          success: false,
          progress: { current: fetchedCount, total: materialsToFetch.length },
        });
      }
    }

    // ── Reconciliation pass ──
    // Gate the candidate lists handed to the reconcile LLM with the same
    // semantic/spec gate round-1 ranking uses. Without this the LLM sees the
    // raw scraper results and can "apply" a candidate the gate already
    // refused — the replay audit caught it choosing 70x35 framing pine for a
    // 140x45 rafter request. chosenIndex indexes this gated list, so the
    // apply step below must read from the same map.
    const gatedCandidatesByMaterialId = new Map<string, ScraperProduct[]>();
    for (const m of updatedMaterials) {
      const raw = candidatesByMaterialId.get(m.id);
      if (!raw || raw.length === 0) continue;
      const gated = raw.filter(
        (c) =>
          isSemanticallyCompatible(m.searchTerm || m.name, c.productName || '') &&
          // Same evidence bar as round-1 ranking. Without it the reconcile
          // model is handed candidates the deterministic layer already
          // refused, and one non-deterministic call is all that stands
          // between a chrome towel bar and a rebar line (QU-178711).
          matchEvidence(m.searchTerm || m.name, c.productName || '') === 'strong',
      );
      if (gated.length > 0) gatedCandidatesByMaterialId.set(m.id, gated);
    }
    const reconcileItems = updatedMaterials
      .filter((m) => {
        if (m.manualPriceOverride) return false;
        if (m.pricingSource === 'manual') return false;
        const cands = gatedCandidatesByMaterialId.get(m.id);
        return !!cands && cands.length > 0;
      })
      .map((m) => {
        const cands = gatedCandidatesByMaterialId.get(m.id) || [];
        return {
          id: m.id,
          name: m.searchTerm || m.name,
          requirement: m.requiredQty ?? m.quantity,
          // requiredQty is stated in the material's ORIGINAL unit, not the
          // pack unit. Labelling "7 posts (each)" as packUnit 'm' made the
          // reconcile LLM divide by the 2.4m length and return 3 posts —
          // the systematic under-buy class in the replay audit.
          requirementUnit: (m.requiredUnit ?? m.packUnit ?? m.unit) as string,
          candidates: cands.slice(0, 5).map((c) => {
            // Forward the product's pack/volume size so the reconcile LLM can
            // see that a $151 product is a 500-screw tub rather than guessing
            // coverage from the name. Fall back to parsing it from the title.
            const parsed = parsePackInfo(c.productName);
            return {
              name: c.productName,
              price: c.price,
              url: c.productUrl,
              description: c.description,
              packSize: c.packSize ?? parsed?.packSize,
              packUnit: c.packUnit ?? parsed?.packUnit,
            };
          }),
        };
      });

    if (reconcileItems.length > 0) {
      onEvent?.({ kind: 'reconcile-start' });
      onEvent?.({ kind: 'phase-start', phase: 'reconcile', status: 'Sorting pack sizes and quantities…' });
      const rejectedRows: Material[] = [];
      try {
        const results = await reconcilePricedMaterials(reconcileItems, {
          jobName: quote.job?.name,
          jobDescription: quote.job?.description,
        });
        const byId = new Map(results.map((r) => [r.id, r]));
        for (const m of updatedMaterials) {
          const r = byId.get(m.id);
          if (!r) continue;
          const outcome = applyReconcileResult(m, r, gatedCandidatesByMaterialId.get(m.id) || [], gstInclusive);
          if (outcome === 'rejected') rejectedRows.push(m);
        }
      } catch {
        // Reconciliation is best-effort — fall back to whatever the per-row
        // pack-aware regex worked out.
      }

      // ── Rejected-row rescue ──
      // A reject means every candidate was the wrong category — usually
      // because the search term was over-specified ("2400x100x100mm CCA
      // Treated Hardwood Post" returns drill bits). Retry once with a
      // category-level term, re-reconcile so the category gate still guards
      // the new candidates, and fall back to a visible estimate rather than
      // shipping a $0 row on the customer's quote.
      if (rejectedRows.length > 0) {
        try {
          const rescueTerm = new Map<string, string>();
          const rescueCands = new Map<string, ScraperProduct[]>();
          for (const m of rejectedRows) {
            checkCancel();
            const simplified = simplifySearchTerm(m.searchTerm || m.name);
            if (!simplified) continue;
            try {
              const cands = await findCandidatesForMaterial(simplified);
              // Gate against the ORIGINAL material name — the simplified
              // term dropped specs on purpose to broaden the search, but the
              // specs still decide what's an acceptable substitute.
              const gated = cands.filter(
                (c) =>
                  isSemanticallyCompatible(m.name, c.productName || '') &&
                  matchEvidence(m.name, c.productName || '') === 'strong',
              );
              if (gated.length > 0) {
                rescueTerm.set(m.id, simplified);
                rescueCands.set(m.id, gated);
              }
            } catch {
              // one search miss shouldn't kill the rescue for other rows
            }
          }
          if (rescueCands.size > 0) {
            const rescueItems = rejectedRows
              .filter((m) => rescueCands.has(m.id))
              .map((m) => ({
                id: m.id,
                name: rescueTerm.get(m.id) || m.name,
                requirement: m.requiredQty ?? m.quantity,
                requirementUnit: (m.requiredUnit ?? m.packUnit ?? m.unit) as string,
                candidates: (rescueCands.get(m.id) || []).slice(0, 5).map((c) => {
                  const parsed = parsePackInfo(c.productName);
                  return {
                    name: c.productName,
                    price: c.price,
                    url: c.productUrl,
                    description: c.description,
                    packSize: (c as { packSize?: number }).packSize ?? parsed?.packSize,
                    packUnit: (c as { packUnit?: string }).packUnit ?? parsed?.packUnit,
                  };
                }),
              }));
            const rescueResults = await reconcilePricedMaterials(rescueItems, {
              jobName: quote.job?.name,
              jobDescription: quote.job?.description,
            });
            const rescueById = new Map(rescueResults.map((r) => [r.id, r]));
            for (const m of rejectedRows) {
              const r = rescueById.get(m.id);
              if (!r) continue;
              const outcome = applyReconcileResult(m, r, rescueCands.get(m.id) || [], gstInclusive);
              if (outcome === 'applied' || outcome === 'estimated') {
                // The simplified term found the product family — keep it so
                // future re-pricing doesn't repeat the dead-end search.
                m.searchTerm = rescueTerm.get(m.id) || m.searchTerm;
              }
            }
          }
        } catch {
          // Rescue is best-effort; rows keep their reject state.
        }

        // Safety net for rows still unpriced after the rescue: a visible
        // low-confidence estimate beats a $0 row — stored quotes show $0
        // rows shipping to customers. Same order as the individual path.
        for (const m of rejectedRows) {
          checkCancel();
          if (m.price > 0) continue;
          try {
            const aiResult = await searchMaterialPrice(m.searchTerm || m.name, hardwareStores);
            if (aiResult.price) {
              m.price = supplierPriceForGstMode(aiResult.price, gstInclusive);
              m.manualPriceOverride = false;
              m.pricingSource = 'ai';
              m.priceConfidence = 'low';
              m.totalPrice = roundToTwoDecimals(m.price * m.quantity);
              m.description = 'Estimated price — verify with supplier before sending';
              continue;
            }
          } catch {
            // fall through to the deterministic table
          }
          applyVisibleFallbackEstimate(m, gstInclusive);
        }
      }
    }

    // ── Final deterministic coverage sweep ──
    // Catches bulk fastener/oil over-buys on rows the reconcile pass skips
    // (locally- and Reece-priced rows), reducing the count without overwriting
    // the resolved unit price. Idempotent — rows already at a sane count, and
    // every non-fastener/non-liquid row, are left untouched.
    //
    // The same loop also runs a geometric clamp for area-derived board
    // piece-goods (e.g. 891 decking boards on a 30 m² deck) — the piece-good
    // case the bulk guard above deliberately skips. Needs the job area, parsed
    // from the description ("15 metre by 2 metre" → 30 m²); null when absent.
    const jobAreaM2 = parseJobAreaM2(quote.job?.description)?.areaM2 ?? null;
    for (const m of updatedMaterials) {
      if (m.manualPriceOverride) continue;
      if (m.requiredQty === undefined || !(m.price > 0)) continue;
      const sane = coverageSanePurchaseCount({
        requirement: m.requiredQty,
        name: m.name,
        // m.price is in the business's GST mode; compare against inc-GST retail.
        perPurchasePrice: gstInclusive ? m.price : roundToTwoDecimals(m.price * 1.1),
        packSize: m.packSize,
      });
      if (sane !== null && sane < m.quantity) {
        m.quantity = sane;
        m.totalPrice = roundToTwoDecimals(m.price * sane);
      }

      // Geometric bounds for board piece-goods. The upper bound catches wild
      // AI multiplication; the lower bound catches the opposite failure seen
      // on this 18m² ModWood quote (14 × 5.4m × 137mm could cover only ~10m²).
      if (jobAreaM2 !== null) {
        const geoMax = geometricSanePieceCount({
          name: m.name,
          requirement: m.requiredQty,
          areaM2: jobAreaM2,
        });
        if (geoMax !== null && geoMax < m.quantity) {
          m.quantity = geoMax;
          m.totalPrice = roundToTwoDecimals(m.price * geoMax);
        }

        // A floor is safe only for discrete each-count boards whose priced name
        // exposes both face width and stock length. The helper returns null
        // rather than guessing either dimension.
        if (m.unit === 'each') {
          const geoMin = geometricMinimumPieceCount({
            name: m.name,
            requirement: m.requiredQty,
            areaM2: jobAreaM2,
          });
          if (geoMin !== null && geoMin > m.quantity) {
            m.requiredQty = geoMin;
            m.quantity = geoMin;
            m.totalPrice = roundToTwoDecimals(m.price * geoMin);
          }
        }
      }
    }
  } catch (err: any) {
    if (err instanceof FetchCancelled) {
      cancelled = true;
    } else {
      throw err;
    }
  }

  onEvent?.({
    kind: 'complete',
    fetched: fetchedCount,
    failed: failedCount,
    skipped: skippedCount,
    cancelled,
  });

  // Fire-and-forget per-run outcome telemetry. One site here covers every
  // caller of fetchPricesForQuote (materials list, Mate, wizard). Must never
  // block or fail the price run — hence the swallowed rejection.
  // bySource is computed over materialsToFetch (the rows this run actually
  // worked on), not the whole quote — pre-priced rows would inflate it and
  // re-runs would recount the entire quote.
  const usageSummary = summarizePriceFetchOutcome(materialsToFetch, {
    fetchedCount,
    failedCount,
    skippedCount,
    cancelled,
  });
  httpsCallable(functions, 'reportPriceFetchUsage')(usageSummary).catch(() => {});

  // ── No silent $0 rows ──
  // A row the pipeline could not price at all keeps price 0 and, until now, no
  // description — so it printed as a bare "$0.00" on the materials list and on
  // the customer's quote with nothing saying why. The rescue path already
  // stamps rows the reconcile pass rejected, but a row whose search returned
  // nothing usable never reaches it: QU-178711 shipped "Steel Formwork Pegs
  // 600mm ×30" at $0.00, unexplained. Work items are lump-sum scope lines, so
  // $0 is a legitimate price for one — they are left alone.
  for (const m of updatedMaterials) {
    if (m.kind === 'work' || m.manualPriceOverride) continue;
    if (m.price > 0 || m.description) continue;
    m.priceConfidence = 'low';
    m.description = 'No price found — add your own price before sending';
  }

  // Baseline for send-time edit telemetry: every pipeline-priced row records
  // the state this run left it in, so edits the tradie makes before sending
  // can be logged as confirmed pipeline misses.
  stampAsPriced(updatedMaterials);

  return {
    updatedQuote: { ...quote, materials: updatedMaterials },
    fetchedCount,
    failedCount,
    skippedCount,
    cancelled,
    reeceReauthNeeded,
  };
}
