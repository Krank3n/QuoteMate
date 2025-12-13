/**
 * Unified Pricing Service
 * Centralizes all pricing logic with priority handling:
 * 1. Reece API (if enabled) - PRIORITY
 * 2. Bunnings Scraper (if Bunnings selected and Reece not enabled)
 * 3. Web scraping fallback
 * 4. AI estimation (last resort)
 */

import { reeceApi } from './reeceApi';
import { searchProductWithScraper } from './bunningsScraperService';
import { searchMaterialWithWebScraping, getBestMatch } from './webScrapingPricing';
import { searchMaterialPrice } from './webSearchPricing';
import { BUNNINGS_SCRAPER_URL } from '@env';

export interface UnifiedProductResult {
  productName: string;
  description?: string;
  itemNumber?: string;
  brand?: string;
  price: number;
  unit?: string;
  productUrl?: string;
  imageUrl?: string;
  store: string;
  stockLevel?: string;
  confidence?: string;
  source: 'reece-api' | 'bunnings-scraper' | 'web-scraping' | 'ai-estimation';
  isReece?: boolean;
  isBunnings?: boolean;
  isAiEstimate?: boolean;
}

export interface UnifiedPricingOptions {
  useReeceApi?: boolean;
  selectedStore?: string;
  hardwareStores?: string[];
  quantity?: number;
  unit?: string;
}

/**
 * Search for material pricing with intelligent priority:
 * 1. If Reece API enabled -> Use Reece (don't use Bunnings)
 * 2. If Bunnings selected -> Use Bunnings scraper
 * 3. Otherwise -> Web scraping
 * 4. Last resort -> AI estimation
 */
export async function searchMaterialPricing(
  searchQuery: string,
  options: UnifiedPricingOptions = {}
): Promise<UnifiedProductResult[]> {
  const {
    useReeceApi = false,
    selectedStore = 'bunnings',
    hardwareStores = ['bunnings.com.au'],
    quantity = 1,
    unit = 'each',
  } = options;

  console.log('🔍 Unified pricing search:', {
    searchQuery,
    useReeceApi,
    selectedStore,
    hardwareStores,
  });

  // PRIORITY 1: Reece API (if enabled)
  // When Reece is enabled, skip Bunnings entirely
  if (useReeceApi || selectedStore === 'reece') {
    console.log('⭐ PRIORITY: Using Reece API (Bunnings scraper disabled)');

    try {
      const reeceResults = await searchWithReeceApi(searchQuery);

      if (reeceResults.length > 0) {
        console.log(`✅ Reece API returned ${reeceResults.length} results`);
        return reeceResults;
      } else {
        console.log('⚠️ Reece API returned no results, falling back to AI estimation');
        // Fall back to AI estimation (skip Bunnings when Reece is enabled)
        return await searchWithAiEstimation(searchQuery, ['reece.com.au']);
      }
    } catch (error) {
      console.error('❌ Reece API error:', error);
      // Fall back to AI estimation
      return await searchWithAiEstimation(searchQuery, ['reece.com.au']);
    }
  }

  // PRIORITY 2: Bunnings Scraper (only if Reece is NOT enabled)
  const firstStore = hardwareStores[0];
  const isBunnings = selectedStore === 'bunnings' || firstStore.includes('bunnings.com.au');
  const useScraperApi = BUNNINGS_SCRAPER_URL ? true : false;

  if (isBunnings && useScraperApi) {
    console.log('🔧 Using Bunnings Scraper API');

    try {
      const bunningsResults = await searchWithBunningsScraper(searchQuery);

      if (bunningsResults.length > 0) {
        console.log(`✅ Bunnings scraper returned ${bunningsResults.length} results`);
        return bunningsResults;
      } else {
        console.log('⚠️ Bunnings scraper returned no results, trying web scraping');
        // Fall back to web scraping
        return await searchWithWebScraping(searchQuery, quantity, unit, [firstStore]);
      }
    } catch (error) {
      console.error('❌ Bunnings scraper error:', error);
      // Fall back to web scraping
      return await searchWithWebScraping(searchQuery, quantity, unit, [firstStore]);
    }
  }

  // PRIORITY 3: Web Scraping
  console.log('🌐 Using web scraping');
  const webResults = await searchWithWebScraping(searchQuery, quantity, unit, [firstStore]);

  if (webResults.length > 0) {
    console.log(`✅ Web scraping returned ${webResults.length} results`);
    return webResults;
  }

  // PRIORITY 4: AI Estimation (last resort)
  console.log('🤖 Using AI estimation as last resort');
  return await searchWithAiEstimation(searchQuery, [firstStore]);
}

/**
 * Search using Reece API with AI-estimated pricing
 */
async function searchWithReeceApi(searchQuery: string): Promise<UnifiedProductResult[]> {
  try {
    console.log('🔍 Searching Reece API for:', searchQuery);

    const results = await reeceApi.searchProducts({
      searchPhrase: searchQuery,
      pageNumber: 1,
      pageSize: 20,
    });

    if (results.totalResults === 0) {
      return [];
    }

    console.log(`✅ Found ${results.totalResults} Reece products, estimating prices...`);

    // Convert Reece products to unified format with AI-estimated prices
    const products: UnifiedProductResult[] = await Promise.all(
      results.products.slice(0, 10).map(async (product) => {
        try {
          // Use AI to estimate price for each Reece product
          const aiResult = await searchMaterialPrice(product.productTitle, ['reece.com.au']);

          return {
            productName: product.productTitle,
            description: product.productTitle,
            itemNumber: product.productId.toString(),
            brand: product.brand,
            price: aiResult.price || 0,
            unit: product.unitOfMeasures.length > 0 ? product.unitOfMeasures[0].code : 'each',
            productUrl: undefined,
            imageUrl: product.productImages.length > 0 ? product.productImages[0].url : undefined,
            store: 'Reece Plumbing',
            confidence: aiResult.price ? 'medium' : 'low',
            source: 'reece-api' as const,
            isReece: true,
          };
        } catch (error) {
          console.error(`⚠️ Error estimating price for ${product.productTitle}:`, error);
          // Return product without price if AI estimation fails
          return {
            productName: product.productTitle,
            description: product.productTitle,
            itemNumber: product.productId.toString(),
            brand: product.brand,
            price: 0,
            unit: product.unitOfMeasures.length > 0 ? product.unitOfMeasures[0].code : 'each',
            productUrl: undefined,
            imageUrl: product.productImages.length > 0 ? product.productImages[0].url : undefined,
            store: 'Reece Plumbing',
            confidence: 'low',
            source: 'reece-api' as const,
            isReece: true,
          };
        }
      })
    );

    const productsWithPrices = products.filter(p => p.price > 0);
    console.log(`✅ ${productsWithPrices.length} of ${products.length} Reece products have estimated prices`);

    return products;
  } catch (error) {
    console.error('❌ Error searching Reece API:', error);
    return [];
  }
}

/**
 * Search using Bunnings Scraper
 */
async function searchWithBunningsScraper(searchQuery: string): Promise<UnifiedProductResult[]> {
  try {
    console.log('🔍 Searching Bunnings scraper for:', searchQuery);

    const scraperResponse = await searchProductWithScraper(searchQuery, 10);

    if (!scraperResponse || !scraperResponse.success || scraperResponse.results.length === 0) {
      return [];
    }

    const products: UnifiedProductResult[] = scraperResponse.results.map(product => ({
      productName: product.productName,
      description: product.description || '',
      itemNumber: product.itemNumber || '',
      brand: product.brand || '',
      price: product.price,
      unit: 'each',
      productUrl: product.productUrl,
      imageUrl: product.imageUrl,
      store: 'Bunnings',
      stockLevel: product.stockLevel,
      confidence: product.confidence,
      source: 'bunnings-scraper',
      isBunnings: true,
    }));

    console.log(`✅ Found ${products.length} Bunnings products`);
    return products;
  } catch (error) {
    console.error('❌ Error searching Bunnings scraper:', error);
    return [];
  }
}

/**
 * Search using web scraping
 */
async function searchWithWebScraping(
  searchQuery: string,
  quantity: number,
  unit: string,
  stores: string[]
): Promise<UnifiedProductResult[]> {
  try {
    console.log('🔍 Searching via web scraping for:', searchQuery);

    const scraperResults = await searchMaterialWithWebScraping(
      searchQuery,
      searchQuery,
      quantity,
      unit,
      stores
    );

    const products: UnifiedProductResult[] = scraperResults.flatMap(r =>
      r.matches.map(match => ({
        productName: match.productName,
        description: match.description || '',
        itemNumber: match.itemNumber || '',
        brand: match.brand || '',
        price: match.price,
        unit: match.unit || 'each',
        productUrl: match.productUrl,
        imageUrl: match.imageUrl,
        store: match.store,
        stockLevel: match.stockLevel,
        confidence: match.confidence,
        source: 'web-scraping' as const,
      }))
    );

    console.log(`✅ Found ${products.length} products via web scraping`);
    return products;
  } catch (error) {
    console.error('❌ Error in web scraping:', error);
    return [];
  }
}

/**
 * Search using AI estimation (last resort)
 */
async function searchWithAiEstimation(
  searchQuery: string,
  stores: string[]
): Promise<UnifiedProductResult[]> {
  try {
    console.log('🔍 Searching via AI estimation for:', searchQuery);

    const aiResult = await searchMaterialPrice(searchQuery, stores);

    if (!aiResult.price) {
      return [];
    }

    const product: UnifiedProductResult = {
      productName: aiResult.productName || searchQuery,
      description: aiResult.store ? `Estimated from ${aiResult.store}` : 'AI Estimated Price',
      itemNumber: '',
      brand: '',
      price: aiResult.price,
      unit: 'each',
      productUrl: undefined,
      imageUrl: undefined,
      store: aiResult.store || stores[0],
      source: 'ai-estimation',
      isAiEstimate: true,
      confidence: 'low',
    };

    console.log(`✅ AI estimation: $${aiResult.price}`);
    return [product];
  } catch (error) {
    console.error('❌ Error in AI estimation:', error);
    return [];
  }
}

/**
 * Get the best single result from search results
 */
export function getBestResult(results: UnifiedProductResult[]): UnifiedProductResult | null {
  if (results.length === 0) return null;

  // Sort by priority:
  // 1. Source priority (reece-api > bunnings-scraper > web-scraping > ai-estimation)
  // 2. Confidence (high > medium > low)
  // 3. Stock level (in-stock > unknown > low-stock > out-of-stock)
  // 4. Price (lowest)

  const sourceScore = {
    'reece-api': 4,
    'bunnings-scraper': 3,
    'web-scraping': 2,
    'ai-estimation': 1,
  };

  const confidenceScore = {
    'high': 3,
    'medium': 2,
    'low': 1,
  };

  const stockScore = {
    'in-stock': 3,
    'unknown': 2,
    'low-stock': 1,
    'out-of-stock': 0,
  };

  const sorted = results.sort((a, b) => {
    // Source priority
    const sourceDiff = sourceScore[b.source] - sourceScore[a.source];
    if (sourceDiff !== 0) return sourceDiff;

    // Confidence
    const confDiff = confidenceScore[b.confidence || 'low'] - confidenceScore[a.confidence || 'low'];
    if (confDiff !== 0) return confDiff;

    // Stock level
    const stockDiff = stockScore[b.stockLevel || 'unknown'] - stockScore[a.stockLevel || 'unknown'];
    if (stockDiff !== 0) return stockDiff;

    // Price (only if both have prices)
    if (a.price > 0 && b.price > 0) {
      return a.price - b.price;
    }

    return 0;
  });

  return sorted[0];
}

/**
 * Format result for display
 */
export function formatResultSource(result: UnifiedProductResult): string {
  switch (result.source) {
    case 'reece-api':
      return '🔵 Reece API';
    case 'bunnings-scraper':
      return '🟢 Bunnings (Real-time)';
    case 'web-scraping':
      return '🟡 Web Search';
    case 'ai-estimation':
      return '🤖 AI Estimate';
    default:
      return result.source;
  }
}
