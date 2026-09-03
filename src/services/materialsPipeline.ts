// Materials pipeline — the phone-side binding of shared/pricing/pipeline.
//
// The pipeline itself (analyse → local rates → Reece → Bunnings → estimate →
// reconcile → coverage sweeps) lives in shared/pricing/pipeline.ts so the
// same code runs inside a Cloud Function when Mate prices a draft (see
// functions/src/pricingRun.ts and src/services/serverPricingRun.ts). This
// module supplies the React Native services it needs, holds the screen awake
// for the duration, and re-exports the public surface so every existing
// caller (the wizard, Mate's apply path, the tests) keeps its import.

import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { withKeepAwake } from '../utils/withKeepAwake';
import type { Quote } from '../types';
import * as pipeline from '../../shared/pricing/pipeline';
import type {
  FetchPricesArgs,
  FetchPricesCallbacks,
  FetchPricesResult,
  GenerateMaterialsArgs,
  GenerateMaterialsCallbacks,
  GenerateMaterialsResult,
  PipelineDeps,
} from '../../shared/pricing/pipeline';
import { analyzeJobDescription, reconcilePricedMaterials } from './llmService';
import { loadAllFavoritesForLLM, loadFavoritesFromLocal } from './materialFavorites';
import { loadTemplatesFromLocal } from './sectionTemplateService';
import { loadGroups as loadSupplierGroups } from './supplierGroupService';
import { searchReeceMaterialCandidates, getReeceConnectionStatus } from './reeceApi';
import { findCandidatesForMaterial, fetchBatchChunkViaProxy } from './bunningsScraperClient';
import { searchMaterialPrice } from './webSearchPricing';

// Every entry is a closure rather than a bare reference so a test that mocks
// one of these modules partially doesn't trip on an export it never needed.
export const phonePipelineDeps: PipelineDeps = {
  analyzeJobDescription: (req) =>
    analyzeJobDescription(
      req.jobDescription,
      req.tradeContext,
      req.photoUrls,
      req.existingMaterials,
      req.availableTemplates,
      req.userSavedRates,
    ),
  reconcilePricedMaterials: (items, context) => reconcilePricedMaterials(items, context),
  estimateMaterialPrice: (term, stores) => searchMaterialPrice(term, stores),
  searchBunningsCandidates: (term) => findCandidatesForMaterial(term),
  batchSearchBunnings: (searches) => fetchBatchChunkViaProxy(searches),
  searchReeceCandidates: (term) => searchReeceMaterialCandidates(term),
  isReeceConnected: async () => {
    try {
      return !!(await getReeceConnectionStatus()).connected;
    } catch {
      return false;
    }
  },
  loadSupplierGroups: () => loadSupplierGroups(),
  loadFavorites: () => loadFavoritesFromLocal(),
  loadPersonalRates: () => loadAllFavoritesForLLM(),
  loadTemplates: () => loadTemplatesFromLocal(),
  reportPriceFetchUsage: (summary) => {
    httpsCallable(functions, 'reportPriceFetchUsage')(summary).catch(() => {});
  },
};

/**
 * Run the analyse step on the phone. Held awake for the whole run — a
 * sleeping phone drops the network and kills the generation mid-flight (see
 * withKeepAwake).
 */
export function generateMaterialsForQuote(
  args: GenerateMaterialsArgs<Quote>,
  callbacks: GenerateMaterialsCallbacks = {},
): Promise<GenerateMaterialsResult<Quote>> {
  return withKeepAwake(() => pipeline.generateMaterialsForQuote(phonePipelineDeps, args, callbacks));
}

/**
 * Run the price fetch + reconcile pipeline on the phone. Same wake guard as
 * generateMaterialsForQuote — price fetches routinely run past the
 * screen-sleep timeout.
 */
export function fetchPricesForQuote(
  args: FetchPricesArgs<Quote>,
  callbacks: FetchPricesCallbacks = {},
): Promise<FetchPricesResult<Quote>> {
  return withKeepAwake(() => pipeline.fetchPricesForQuote(phonePipelineDeps, args, callbacks));
}

export {
  applyReconcileResult,
  applyLastResortGuess,
  LAST_RESORT_GUESS_PRICE,
  LAST_RESORT_GUESS_PREFIX,
  PipelineCancelled,
  summarizePriceFetchOutcome,
} from '../../shared/pricing/pipeline';
export type { PricingEvent } from '../../shared/pricing/pipeline';
