/**
 * Bunnings Scraper API Client
 *
 * Connects to your separate Bunnings scraper microservice
 * to fetch real product data and pricing.
 */

import { BUNNINGS_SCRAPER_URL, BUNNINGS_SCRAPER_API_KEY } from '@env';

const SCRAPER_API_URL = BUNNINGS_SCRAPER_URL;
const SCRAPER_API_KEY = BUNNINGS_SCRAPER_API_KEY;

export interface ScraperProduct {
  productName: string;
  description?: string;
  price: number;
  priceIncGst: number;
  unit: string;
  dimensions?: string;
  itemNumber: string;
  brand?: string;
  stockLevel: 'in-stock' | 'low-stock' | 'out-of-stock' | 'unknown';
  stockCheckedAt?: string; // ISO timestamp of when stock was checked
  productUrl: string;
  imageUrl?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ScraperSearchResponse {
  success: boolean;
  results: ScraperProduct[];
  searchUrl: string;
  cached: boolean;
  timestamp: string;
  error?: string;
}

/**
 * Search for products using the Bunnings scraper API
 */
export async function searchBunningsProducts(
  searchTerm: string,
  limit: number = 5
): Promise<ScraperSearchResponse> {
  try {
    const response = await fetch(`${SCRAPER_API_URL}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': SCRAPER_API_KEY,
      },
      body: JSON.stringify({
        searchTerm,
        limit,
        sortBy: 'relevance',
      }),
    });

    if (!response.ok) {
      throw new Error(`Scraper API returned ${response.status}: ${response.statusText}`);
    }

    const data: ScraperSearchResponse = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Search failed');
    }


    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Get specific product details by item number
 */
export async function getBunningsProduct(itemNumber: string): Promise<ScraperProduct | null> {
  try {
    const response = await fetch(`${SCRAPER_API_URL}/api/product/${itemNumber}`, {
      headers: {
        'X-API-Key': SCRAPER_API_KEY,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Scraper API returned ${response.status}`);
    }

    const data = await response.json();
    return data.success ? data.product : null;
  } catch (error) {
    return null;
  }
}

/**
 * Check if scraper API is healthy
 */
export async function checkScraperHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${SCRAPER_API_URL}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const isHealthy = data.success && data.status === 'healthy';

    if (isHealthy) {
    } else {
    }

    return isHealthy;
  } catch (error) {
    return false;
  }
}

/**
 * Search and get the best match for a material
 */
export async function findBestMatchForMaterial(
  materialName: string
): Promise<ScraperProduct | null> {
  try {
    const response = await searchBunningsProducts(materialName, 5);

    if (!response.success || response.results.length === 0) {
      return null;
    }

    // Filter for high confidence matches with prices
    const goodMatches = response.results.filter(
      (p) => p.confidence === 'high' && p.price > 0
    );

    if (goodMatches.length > 0) {
      return goodMatches[0]; // Return best match
    }

    // Fallback to medium confidence
    const mediumMatches = response.results.filter(
      (p) => p.confidence === 'medium' && p.price > 0
    );

    if (mediumMatches.length > 0) {
      return mediumMatches[0];
    }

    // Last resort: return first result even if price is 0
    return response.results[0];
  } catch (error) {
    return null;
  }
}

/**
 * Batch search for best matches across multiple materials, processing in chunks.
 * Calls onChunkComplete after each chunk finishes so the UI can update progressively.
 */
export async function batchFindBestMatchesProgressive(
  searchTerms: string[],
  _maxResultsPerTerm: number = 5,
  chunkSize: number = 3,
  onChunkComplete?: (
    chunkResults: Map<string, ScraperProduct | null>,
    chunkTerms: string[],
    chunkIndex: number,
    totalChunks: number,
  ) => void,
  isCancelled?: () => boolean,
): Promise<Map<string, ScraperProduct | null>> {
  const allResults = new Map<string, ScraperProduct | null>();
  const totalChunks = Math.ceil(searchTerms.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    if (isCancelled?.()) {
      throw new Error('__FETCH_CANCELLED__');
    }

    const chunkTerms = searchTerms.slice(i * chunkSize, (i + 1) * chunkSize);
    const chunkResults = new Map<string, ScraperProduct | null>();

    await Promise.all(
      chunkTerms.map(async (term) => {
        const result = await findBestMatchForMaterial(term);
        chunkResults.set(term, result);
        allResults.set(term, result);
      }),
    );

    onChunkComplete?.(chunkResults, chunkTerms, i, totalChunks);
  }

  return allResults;
}
