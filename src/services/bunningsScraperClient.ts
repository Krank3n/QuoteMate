/**
 * Bunnings Scraper API Client
 *
 * Routes through Firebase Functions proxy so the scraper API key stays
 * server-side and we avoid mixed-content (HTTP) blocking from web/iOS/Android.
 * The proxy forwards to the same scraper microservice.
 */

import { auth } from '../config/firebase';
import { withScraperRetry } from '../../shared/pricing/scraperRetry';
// The wire shape, result normalisation and batch chunking live in
// shared/pricing so the server-side pricing run ranks candidates identically.
import {
  batchSearchProgressive,
  rankCandidates,
  type BatchSearchRequest,
  type BatchSearchResponseItem,
  type ScraperProduct,
  type ScraperSearchResponse,
} from '../../shared/pricing/scraperCandidates';
export { normaliseScraperProduct } from '../../shared/pricing/scraperCandidates';
export type { ScraperProduct, ScraperSearchResponse } from '../../shared/pricing/scraperCandidates';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

/**
 * Resolve the signed-in user's ID token for the authenticated scraper proxies.
 * Never send "Bearer undefined": a missing token (cold-start auth restore,
 * offline refresh) guarantees a 401 that the callers swallow as "no results",
 * which reads as a silently unpriced quote. Throw a distinct error instead so
 * the failure is at least logged.
 */
async function scraperAuthHeaders(): Promise<Record<string, string>> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    console.warn('[bunningsScraper] no auth token available — skipping scraper call');
    throw new Error('SCRAPER_AUTH_MISSING');
  }
  return { Authorization: `Bearer ${idToken}` };
}

/**
 * Search for products using the Bunnings scraper API
 */
export async function searchBunningsProducts(
  searchTerm: string,
  limit: number = 5
): Promise<ScraperSearchResponse> {
  // Transient network blips (mobile radios, droplet resets) get a couple of
  // retries; auth and application failures throw straight through.
  return withScraperRetry(async () => {
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/bunningsScraperSearch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await scraperAuthHeaders()),
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
  });
}

/**
 * Get specific product details by item number
 */
export async function getBunningsProduct(itemNumber: string): Promise<ScraperProduct | null> {
  try {
    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/bunningsScraperProduct?itemNumber=${encodeURIComponent(itemNumber)}`,
      { headers: await scraperAuthHeaders() },
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
    // The health endpoint is deliberately unauthenticated (cheap liveness
    // probe) — no Authorization header needed.
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/bunningsScraperHealth`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
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
 * Search and get the best match for a material (single-product convenience
 * wrapper; new code should prefer findCandidatesForMaterial so the LLM
 * reconciliation pass can pick across alternatives).
 */
export async function findBestMatchForMaterial(
  materialName: string
): Promise<ScraperProduct | null> {
  const candidates = await findCandidatesForMaterial(materialName);
  return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Return up to `max` ranked candidates for a material. Reconciliation can
 * then evaluate the full slate against the requirement instead of being
 * stuck with the scraper's string-similarity best guess.
 */
export async function findCandidatesForMaterial(
  materialName: string,
  max: number = 5,
): Promise<ScraperProduct[]> {
  try {
    const response = await searchBunningsProducts(materialName, max);
    if (!response.success || response.results.length === 0) return [];
    return rankCandidates(response.results).slice(0, max);
  } catch {
    return [];
  }
}

/**
 * Batch search for best matches across multiple materials — the chunking,
 * retries and progressive callbacks live in shared/pricing/scraperCandidates
 * so the server-side pricing run batches identically. This wrapper supplies
 * the one environment-specific piece: the HTTP call to the Functions proxy.
 */
export async function batchFindBestMatchesProgressive(
  searchTerms: string[],
  maxResultsPerTerm: number = 5,
  chunkSize: number = 3,
  onChunkComplete?: (
    chunkResults: Map<string, ScraperProduct[]>,
    chunkTerms: string[],
    chunkIndex: number,
    totalChunks: number,
  ) => void,
  isCancelled?: () => boolean,
): Promise<Map<string, ScraperProduct[]>> {
  return batchSearchProgressive(
    fetchBatchChunkViaProxy,
    searchTerms,
    maxResultsPerTerm,
    chunkSize,
    onChunkComplete,
    isCancelled,
  );
}

/** One chunk of a batch search, posted to the Functions proxy. */
export async function fetchBatchChunkViaProxy(searches: BatchSearchRequest[]): Promise<BatchSearchResponseItem[]> {
  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/bunningsScraperBatchSearch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await scraperAuthHeaders()),
    },
    body: JSON.stringify({ searches }),
  });

  if (!response.ok) {
    throw new Error(`Batch scraper returned ${response.status}: ${response.statusText}`);
  }

  const parsed = await response.json();

  if (!parsed.success || !Array.isArray(parsed.results)) {
    throw new Error(parsed.error || 'Batch search failed');
  }
  return parsed.results as BatchSearchResponseItem[];
}
