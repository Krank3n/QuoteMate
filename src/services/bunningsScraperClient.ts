/**
 * Bunnings Scraper API Client
 *
 * Routes through Firebase Functions proxy so the scraper API key stays
 * server-side and we avoid mixed-content (HTTP) blocking from web/iOS/Android.
 * The proxy forwards to the same scraper microservice.
 */

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

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
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/bunningsScraperSearch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/bunningsScraperProduct?itemNumber=${encodeURIComponent(itemNumber)}`,
    );

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
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/bunningsScraperHealth`, {
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
 * Pick the best match from a list of scraper results, mirroring
 * findBestMatchForMaterial's filter logic (high → medium → first).
 */
function pickBestMatch(results: ScraperProduct[]): ScraperProduct | null {
  if (!results || results.length === 0) return null;

  const highWithPrice = results.filter((p) => p.confidence === 'high' && p.price > 0);
  if (highWithPrice.length > 0) return highWithPrice[0];

  const mediumWithPrice = results.filter((p) => p.confidence === 'medium' && p.price > 0);
  if (mediumWithPrice.length > 0) return mediumWithPrice[0];

  return results[0];
}

/**
 * Batch search for best matches across multiple materials.
 *
 * Splits the search terms into chunks of `chunkSize`, sends each chunk to the
 * scraper's /api/batch-search endpoint (via the Firebase proxy) as ONE HTTP
 * request, and fires `onChunkComplete` after each chunk so the UI can update
 * progressively as results stream in.
 *
 * Why chunked-server-batches and not (a) one big batch or (b) N individual
 * requests:
 *  - One big batch = no progressive UI updates, app feels frozen for 30-60s
 *    while waiting for the whole thing.
 *  - N parallel single requests = each one is its own HTTP request with its
 *    own iOS/Android 60s timeout, easy to time out under load.
 *  - Chunked batches give us both: each chunk is fast (~5-15s for 3 items),
 *    UI updates after each chunk, no per-item timeout problem.
 */
export async function batchFindBestMatchesProgressive(
  searchTerms: string[],
  maxResultsPerTerm: number = 5,
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

  if (searchTerms.length === 0) {
    return allResults;
  }

  // Server caps at 50 per batch request; clamp chunkSize to that just in case.
  // The caller currently passes 3, which is the sweet spot for visible progress.
  const effectiveChunkSize = Math.max(1, Math.min(chunkSize, 50));

  const chunks: string[][] = [];
  for (let i = 0; i < searchTerms.length; i += effectiveChunkSize) {
    chunks.push(searchTerms.slice(i, i + effectiveChunkSize));
  }
  const totalChunks = chunks.length;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (isCancelled?.()) {
      throw new Error('__FETCH_CANCELLED__');
    }

    const chunkTerms = chunks[chunkIndex];
    const chunkResults = new Map<string, ScraperProduct | null>();

    try {
      const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/bunningsScraperBatchSearch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          searches: chunkTerms.map((term) => ({
            searchTerm: term,
            limit: maxResultsPerTerm,
            sortBy: 'relevance',
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Batch scraper returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success || !Array.isArray(data.results)) {
        throw new Error(data.error || 'Batch search failed');
      }

      // Map server results back to terms.
      for (const item of data.results as Array<{
        searchTerm: string;
        success: boolean;
        results: ScraperProduct[];
      }>) {
        const best = item.success ? pickBestMatch(item.results) : null;
        chunkResults.set(item.searchTerm, best);
        allResults.set(item.searchTerm, best);
      }

      // Any term the server didn't echo back gets null (defensive).
      for (const term of chunkTerms) {
        if (!chunkResults.has(term)) {
          chunkResults.set(term, null);
          allResults.set(term, null);
        }
      }
    } catch (error) {
      // On chunk failure, mark every term in this chunk as null so the UI
      // doesn't hang waiting on it. Fire the callback so the UI updates,
      // then continue to the next chunk instead of aborting the whole batch.
      // (Re-throw cancellation immediately.)
      if (error instanceof Error && error.message === '__FETCH_CANCELLED__') {
        throw error;
      }
      for (const term of chunkTerms) {
        chunkResults.set(term, null);
        allResults.set(term, null);
      }
      // Don't throw — fire callback and continue to next chunk so a single
      // failed chunk doesn't kill the whole quote.
    }

    onChunkComplete?.(chunkResults, chunkTerms, chunkIndex, totalChunks);
  }

  return allResults;
}
