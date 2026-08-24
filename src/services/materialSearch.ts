/**
 * Material search orchestrator.
 *
 * Walks four sources in priority order — local templates/favorites, Reece
 * trade prices (when connected), the Bunnings scraper, and finally an AI
 * estimate — and returns a flat list of result rows shaped to plug straight
 * into the existing search-results UI. Pure async; no React state.
 *
 * Lifted out of AddMaterialScreen's `handleSearch` so both the existing
 * search tab and the new inline-add row on MaterialsListScreen share one
 * implementation.
 */

import { searchLocalSources, type LocalSearchResult } from './localMaterialSearch';
import { searchReeceMaterialPrice } from './reeceApi';
import { searchBunningsProducts, type ScraperSearchResponse } from './bunningsScraperClient';
import { searchMaterialWithWebScraping } from './webScrapingPricing';
import { searchMaterialPrice } from './webSearchPricing';
import type { SupplierGroup, BusinessSettings } from '../types';

/**
 * 'light' = local templates/favorites + Reece (cheap: in-memory + one HTTP
 *           call). Safe to auto-fire on every keystroke.
 * 'full'  = light + Bunnings scraper + web scraping + AI estimation. Should
 *           only run on an explicit user gesture (e.g. tapping a magnifier
 *           button) — the Bunnings step in particular drives a remote
 *           Playwright instance and is expensive.
 */
export type MaterialSearchMode = 'light' | 'full';

export interface MaterialSearchOptions {
  mode?: MaterialSearchMode;
  businessSettings?: BusinessSettings | null;
  supplierGroups: SupplierGroup[];
  selectedSupplierGroupId?: string;
  reeceConnected: boolean;
  /** Called when Reece returns reauthRequired so the caller can clear state. */
  onReeceReauthRequired?: () => void;
}

export interface MaterialSearchOutcome {
  results: any[];
  error?: string;
}

export async function runMaterialSearch(
  rawQuery: string,
  opts: MaterialSearchOptions,
): Promise<MaterialSearchOutcome> {
  const query = rawQuery.trim();
  if (!query) {
    return { results: [] };
  }

  const mode: MaterialSearchMode = opts.mode ?? 'full';
  const includeHeavy = mode === 'full';

  try {
    const scopedSupplier = opts.selectedSupplierGroupId
      ? opts.supplierGroups.find(g => g.id === opts.selectedSupplierGroupId) ?? null
      : null;
    const scopedToOne = !!scopedSupplier;
    const supplierScope = scopedSupplier ? [scopedSupplier] : opts.supplierGroups;

    // ── Step 1: local sources ──
    let localResults: LocalSearchResult[] = [];
    try {
      localResults = await searchLocalSources(query, supplierScope, {
        includeTemplates: !scopedToOne,
        priorityOrder: opts.businessSettings?.supplierPriority,
      });
    } catch {
      localResults = [];
    }

    // ── Remote fallback ──
    const hardwareStores = opts.businessSettings?.hardwareStores || ['bunnings.com.au'];
    const fallbackStore = hardwareStores[0];

    const hasBunningsInHardwareStores = hardwareStores.some(s =>
      s.toLowerCase().includes('bunnings'));
    const scopedToBunnings = scopedSupplier
      ? scopedSupplier.name.toLowerCase().includes('bunnings')
      : false;
    const shouldTryBunnings = scopedToOne
      ? scopedToBunnings
      : (hasBunningsInHardwareStores || opts.supplierGroups.length === 0);

    const scopedStores = scopedSupplier?.searchUrl?.trim()
      ? [scopedSupplier.searchUrl.trim()]
      : [];
    const supplierStores = opts.supplierGroups
      .map(g => g.searchUrl?.trim())
      .filter((url): url is string => !!url);
    const storesToScrape = scopedToOne
      ? scopedStores
      : (supplierStores.length > 0 ? supplierStores : [fallbackStore]);

    let remoteResults: any[] = [];

    // ── Step 2: Reece priority when connected (unscoped only) ──
    if (opts.reeceConnected && !scopedToOne) {
      try {
        const reeceResult = await searchReeceMaterialPrice(query);
        if (reeceResult.reauthRequired) {
          opts.onReeceReauthRequired?.();
        } else if (reeceResult.price && reeceResult.itemNumber) {
          remoteResults = [{
            productName: reeceResult.productName || query,
            description: 'Reece trade price',
            itemNumber: reeceResult.itemNumber,
            brand: '',
            price: reeceResult.price,
            productUrl: reeceResult.productUrl || '',
            imageUrl: reeceResult.imageUrl || '',
            store: reeceResult.store || 'Reece Plumbing',
            isScraperResult: true,
            reeceItemNumber: reeceResult.itemNumber,
            reeceUnitOfMeasure: reeceResult.unitOfMeasure || null,
          }];
        }
      } catch {
        // Reece miss — fall through.
      }
    }

    // ── Step 3: Bunnings scraper (heavy — full mode only) ──
    if (includeHeavy && remoteResults.length === 0 && shouldTryBunnings) {
      let scraperResponse: ScraperSearchResponse | null = null;
      try {
        scraperResponse = await searchBunningsProducts(query, 10);
      } catch {
        scraperResponse = null;
      }
      if (scraperResponse && scraperResponse.success && scraperResponse.results.length > 0) {
        remoteResults = scraperResponse.results.map(product => ({
          productName: product.productName,
          description: product.description || '',
          itemNumber: product.itemNumber || '',
          brand: product.brand || '',
          price: product.price,
          productUrl: product.productUrl,
          imageUrl: product.imageUrl,
          store: 'bunnings.com.au',
          stockLevel: product.stockLevel,
          isScraperResult: true,
          confidence: product.confidence,
        }));
      }
    }

    // ── Step 4: Web scraping for configured suppliers (heavy — full mode only) ──
    if (includeHeavy && remoteResults.length === 0 && storesToScrape.length > 0) {
      try {
        const scraperResults = await searchMaterialWithWebScraping(
          query, query, 1, 'each', storesToScrape,
        );
        remoteResults = scraperResults.flatMap(r => r.matches).map(match => ({
          productName: match.productName,
          description: match.description || '',
          itemNumber: match.itemNumber || '',
          brand: match.brand || '',
          price: match.price,
          productUrl: match.productUrl,
          imageUrl: match.imageUrl,
          store: match.store,
          isScraperResult: true,
        }));
      } catch {
        remoteResults = [];
      }
    }

    // ── Step 5: AI estimate (heavy — full mode only, last resort) ──
    if (includeHeavy && remoteResults.length === 0 && localResults.length === 0) {
      const aiStores = storesToScrape.length > 0 ? storesToScrape : [fallbackStore];
      try {
        const aiResult = await searchMaterialPrice(query, aiStores);
        if (aiResult.price) {
          remoteResults = [{
            productName: aiResult.productName || query,
            description: 'Rough guess — worth checking',
            itemNumber: '',
            brand: '',
            price: aiResult.price,
            productUrl: undefined,
            imageUrl: undefined,
            store: aiResult.store || aiStores[0],
            isScraperResult: false,
            isAiEstimate: true,
          }];
        }
      } catch {
        // AI miss — return whatever we already have.
      }
    }

    return { results: [...localResults, ...remoteResults] };
  } catch (err: any) {
    return { results: [], error: err?.message || 'Search failed' };
  }
}
