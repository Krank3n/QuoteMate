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
import { buildTradeContext } from '../utils/buildTradeContext';
import { supplierPriceForGstMode, roundToTwoDecimals } from '../utils/quoteCalculator';
import { applyPackAwarePricing } from '../utils/packAwarePricing';
import { parsePackInfo } from '../utils/parsePackInfo';
import { coverageSanePurchaseCount } from '../utils/purchaseCoverage';
import { parseJobAreaM2, geometricSanePieceCount } from '../utils/geometricCoverage';
import {
  analyzeJobDescription,
  convertLLMMaterialsToMaterials,
  reconcilePricedMaterials,
} from './llmService';
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
import { pickBestCandidate, type RankableCandidate } from './candidateRanker';

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
export async function generateMaterialsForQuote(
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
      return {
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
      };
    }
    return {
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
    };
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
    const useDays = perUnitHours >= 5;
    const laborRate = useDays ? defaultRate * 8 : defaultRate;
    const laborHoursValue = useDays ? perUnitHours / 8 : perUnitHours;
    newSections.push({
      id: `section-${Date.now()}-${sectionName.replace(/\s/g, '')}`,
      name: sectionName,
      multiplier,
      laborHours: laborHoursValue,
      laborHoursTotal: Math.round(laborHoursValue * multiplier * 100) / 100,
      laborRate,
      laborUnit: useDays ? 'days' : 'hours',
      laborTotal: laborHoursValue * laborRate * multiplier,
      sortOrder: existingSections.length + newSections.length,
    });
  });

  const hasExistingMaterials = quote.materials.length > 0;
  const updatedQuote: Quote = {
    ...quote,
    job: { ...quote.job, estimatedHours: analysis.estimatedHours } as Quote['job'],
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

export async function fetchPricesForQuote(
  args: FetchPricesArgs,
  callbacks: FetchPricesCallbacks = {},
): Promise<FetchPricesResult> {
  const { quote, businessSettings } = args;
  const { onEvent, shouldCancel } = callbacks;

  const gstInclusive = quote.pricesIncludeGst === true;
  const updatedMaterials: Material[] = quote.materials.map((m) => ({ ...m }));
  // Job-level quality tier inferred at analysis time. Inherited by any
  // material that doesn't carry its own tier. See candidateRanker for the
  // ranking math — the short version: "premium" pushes selection toward the
  // high end of the supplier search results instead of just hits[0].
  const jobQualityTier = quote.qualityTier;

  const checkCancel = () => {
    if (shouldCancel?.()) throw new FetchCancelled();
  };

  // Set of materials that need pricing (skip already-priced, non-overridden).
  const materialsToFetch = updatedMaterials.filter(
    (m) => !(m.price > 0 && !m.manualPriceOverride),
  );

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
  try {
    const supplierList = await loadSupplierGroups();
    for (let i = 0; i < updatedMaterials.length; i++) {
      checkCancel();
      const m = updatedMaterials[i];
      if (m.price > 0 && !m.manualPriceOverride) continue;
      const term = m.searchTerm || m.name;
      let hits: { price: number; productName?: string; productUrl?: string; imageUrl?: string; unit?: string }[] = [];
      try {
        hits = await searchLocalSources(term, supplierList);
      } catch {
        hits = [];
      }
      if (hits.length === 0) continue;
      // Use the ranker to pick the best hit instead of just hits[0]. The
      // saved-supplier-rate path is usually 1–2 hits so the ranker mostly
      // no-ops here, but keeping the API consistent across paths means
      // future saved-rate libraries that return more candidates benefit
      // automatically.
      const ranked = pickBestCandidate(hits as RankableCandidate[], {
        name: m.name,
        searchTerm: m.searchTerm,
        qualityTier: m.qualityTier,
      }, { jobQualityTier }) as (typeof hits[number]) | null;
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
      });
    }
  } catch {
    // Best-effort — fall through.
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
          { jobQualityTier },
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
      fetchedCount += 1;
      reecePricedTerms.add(term);
      onEvent?.({
        kind: 'item-priced',
        phase: overrideExisting ? 'reece-pre' : 'reece-post',
        materialId: m.id,
        name: m.name,
        success: true,
        progress: { current: fetchedCount, total: materialsToFetch.length },
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
      .filter((term) => !locallyPricedTerms.has(term) && !reecePricedTerms.has(term));

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
                pickBestCandidate(candidates as RankableCandidate[], material, { jobQualityTier }) as ScraperProduct | null
                || candidates[0]
                || null;
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
        if (m.price > 0 && !m.manualPriceOverride) continue;
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
    const stillUnpriced = updatedMaterials.filter((m) => !(m.price > 0 && !m.manualPriceOverride));
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
      if (material.price > 0 && !material.manualPriceOverride) continue;
      fetchIndex += 1;
      const searchTerm = material.searchTerm || material.name;

      try {
        let candidates = batchResults?.get(searchTerm) ?? [];
        if (!candidates || candidates.length === 0) {
          candidates = await findCandidatesForMaterial(searchTerm);
        }
        if (candidates.length > 0) candidatesByMaterialId.set(material.id, candidates);
        // Tier-aware pick on the individual-fallback path too — same logic
        // as the batch path above. The supplier ranker put a budget SKU
        // first; we want the one that matches this material's quality tier.
        const product =
          pickBestCandidate(candidates as RankableCandidate[], material, { jobQualityTier }) as ScraperProduct | null
          || candidates[0]
          || null;

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
          fetchedCount += 1;
          onEvent?.({
            kind: 'item-priced',
            phase: 'individual',
            materialId: material.id,
            name: material.name,
            success: true,
            progress: { current: fetchedCount, total: materialsToFetch.length },
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
            material.priceConfidence = aiResult.confidence || 'medium';
            if (aiResult.productName) material.name = aiResult.productName;
            if (aiResult.store) material.description = `AI reckons about this much`;
            applyPackAwarePricing(material, { productName: aiResult.productName });
            fetchedCount += 1;
            onEvent?.({
              kind: 'item-priced',
              phase: 'individual',
              materialId: material.id,
              name: material.name,
              success: true,
              progress: { current: fetchedCount, total: materialsToFetch.length },
            });
            continue;
          }
        } catch {
          // fall through to failed
        }
        failedCount += 1;
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
    const reconcileItems = updatedMaterials
      .filter((m) => {
        if (m.manualPriceOverride) return false;
        if (m.pricingSource === 'manual') return false;
        const cands = candidatesByMaterialId.get(m.id);
        return !!cands && cands.length > 0;
      })
      .map((m) => {
        const cands = candidatesByMaterialId.get(m.id) || [];
        return {
          id: m.id,
          name: m.searchTerm || m.name,
          requirement: m.requiredQty ?? m.quantity,
          requirementUnit: (m.packUnit ?? m.unit) as string,
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
      try {
        const results = await reconcilePricedMaterials(reconcileItems, {
          jobName: quote.job?.name,
          jobDescription: quote.job?.description,
        });
        const byId = new Map(results.map((r) => [r.id, r]));
        for (const m of updatedMaterials) {
          const r = byId.get(m.id);
          if (!r) continue;
          if (r.decision === 'reject') {
            m.price = 0;
            m.totalPrice = 0;
            m.priceConfidence = 'low';
            m.description = r.rejectReason || 'Product mismatch — verify before sending';
            continue;
          }
          if (
            r.decision === 'estimate' &&
            typeof r.estimatedUnitPrice === 'number' &&
            r.estimatedUnitPrice > 0 &&
            typeof r.purchaseCount === 'number' &&
            r.purchaseCount > 0
          ) {
            if (m.requiredQty === undefined) m.requiredQty = m.quantity;
            // Deterministic coverage guard — no candidate matched, so no pack
            // size is known; relies on the estimated unit price being bulk.
            let estPurchaseCount = r.purchaseCount;
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
            continue;
          }
          if (r.decision === 'apply' && typeof r.purchaseCount === 'number' && r.purchaseCount > 0) {
            const cands = candidatesByMaterialId.get(m.id) || [];
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
            const candidatePackSize =
              (chosen as { packSize?: number } | undefined)?.packSize ??
              parsePackInfo(chosen?.productName)?.packSize;
            const sane = coverageSanePurchaseCount({
              requirement: m.requiredQty,
              name: m.name,
              perPurchasePrice: impliedUnitInc,
              packSize: candidatePackSize ?? undefined,
            });
            const purchaseCount = sane !== null && sane < originalCount ? sane : originalCount;
            m.quantity = purchaseCount;
            if (r.purchaseUnit) m.unit = r.purchaseUnit as Material['unit'];
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
          }
        }
      } catch {
        // Reconciliation is best-effort — fall back to whatever the per-row
        // pack-aware regex worked out.
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

      // Geometric clamp: board piece-goods (decking/weatherboard/cladding)
      // whose count is wildly over a width-derived ceiling for the job area.
      // Reasonable counts and every non-board row pass through untouched.
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

  return {
    updatedQuote: { ...quote, materials: updatedMaterials },
    fetchedCount,
    failedCount,
    skippedCount,
    cancelled,
    reeceReauthNeeded,
  };
}
