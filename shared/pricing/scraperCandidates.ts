/**
 * Bunnings scraper results — the wire shape, the normalisation every result
 * passes through, and the chunked batch orchestration.
 *
 * Extracted from src/services/bunningsScraperClient.ts so the server-side
 * pricing run ranks and batches candidates exactly as the app does. Only the
 * HTTP call itself is environment-specific: the app posts to the Functions
 * proxy, the server calls the scraper directly. Both hand this module a
 * BatchChunkFetcher and get the same progressive results back.
 */

import { withScraperRetry } from './scraperRetry';

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
  // Optional pack/length size the price covers (e.g. 500 each, 5.4 m, 20 m).
  // When present, callers should compute packs-needed = ceil(required / packSize)
  // before multiplying by price. Server may populate, otherwise client parses
  // it out of productName via parsePackInfo().
  packSize?: number;
  packUnit?: string;
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
 * Coerce `description` to the string this module's type has always claimed.
 *
 * The scraper actually returns it as an ARRAY of bullet strings. Nothing
 * normalised it, so the array reached `material.description`, and from there
 * `applyReconcileResult` fed it to `parsePackInfo`, which calls `.trim()` on
 * it and throws. Both reconcile call sites wrap the loop in a bare catch, so
 * the whole safety pass — coverage floor, over-buy clamp, category gate —
 * was abandoned from the first applied row onward with nothing logged.
 *
 * Measured over 24 real customer quotes: reconcile died on 23 of them and
 * only 7% of rows were ever checked. Worst case was a bulk-bag price charged
 * per kilogram — $162,785 for drainage gravel that costs $2,432.
 *
 * Normalising here covers both entry points, since batch and individual
 * searches both funnel through rankCandidates.
 */
export function normaliseScraperProduct(p: ScraperProduct): ScraperProduct {
  if (!Array.isArray((p as { description?: unknown }).description)) return p;
  const bullets = (p as unknown as { description: unknown[] }).description;
  return { ...p, description: bullets.filter((b) => typeof b === 'string').join('. ') };
}

/**
 * Sort scraper results by usefulness for reconciliation: priced & high
 * confidence first, then priced & medium, then anything else. Identical
 * tier ordering to the previous pickBestMatch — just doesn't throw the
 * runners-up away.
 */
export function rankCandidates(results: ScraperProduct[]): ScraperProduct[] {
  if (!results || results.length === 0) return [];
  const tier = (p: ScraperProduct): number => {
    const hasPrice = p.price > 0;
    if (p.confidence === 'high' && hasPrice) return 0;
    if (p.confidence === 'medium' && hasPrice) return 1;
    if (hasPrice) return 2;
    return 3;
  };
  return [...results].map(normaliseScraperProduct).sort((a, b) => tier(a) - tier(b));
}

/** One search in a batch request, as the scraper's /api/batch-search takes it. */
export interface BatchSearchRequest {
  searchTerm: string;
  limit: number;
  sortBy: 'relevance';
}

/** One search's answer from a batch request. */
export interface BatchSearchResponseItem {
  searchTerm: string;
  success: boolean;
  results: ScraperProduct[];
}

/**
 * Performs ONE batch request (one chunk) and returns the per-term answers.
 * Throw on transport/application failure — the orchestrator retries transient
 * errors and marks the chunk's terms unpriced on anything else. Error messages
 * should carry the HTTP status ("Batch scraper returned 503: …") so
 * isTransientScraperError can classify them.
 */
export type BatchChunkFetcher = (searches: BatchSearchRequest[]) => Promise<BatchSearchResponseItem[]>;

/**
 * Batch search for best matches across multiple materials.
 *
 * Splits the search terms into chunks of `chunkSize`, sends each chunk as ONE
 * request via `fetchChunk`, and fires `onChunkComplete` after each chunk so
 * the UI can update progressively as results stream in.
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
export async function batchSearchProgressive(
  fetchChunk: BatchChunkFetcher,
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
  const allResults = new Map<string, ScraperProduct[]>();

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
    const chunkResults = new Map<string, ScraperProduct[]>();

    try {
      // Retry the whole chunk on transient failures — losing a chunk means
      // those rows silently drop from shelf prices to estimates. Cancellation
      // stops the retries between attempts.
      const items = await withScraperRetry(
        () =>
          fetchChunk(
            chunkTerms.map((term) => ({ searchTerm: term, limit: maxResultsPerTerm, sortBy: 'relevance' })),
          ),
        {
          shouldAbort: () => isCancelled?.() === true,
          onRetry: (attempt, err) =>
            console.warn(
              `[bunningsScraper] batch chunk ${chunkIndex + 1}/${totalChunks} attempt ${attempt} failed, retrying: ${err instanceof Error ? err.message : String(err)}`,
            ),
        },
      );

      // Map server results back to terms — preserve the full ranked
      // candidate list so reconciliation can evaluate alternatives.
      for (const item of items) {
        const ranked = item.success ? rankCandidates(item.results) : [];
        chunkResults.set(item.searchTerm, ranked);
        allResults.set(item.searchTerm, ranked);
      }

      // Any term the server didn't echo back gets an empty array (defensive).
      for (const term of chunkTerms) {
        if (!chunkResults.has(term)) {
          chunkResults.set(term, []);
          allResults.set(term, []);
        }
      }
    } catch (error) {
      // On chunk failure, mark every term in this chunk as empty so the UI
      // doesn't hang waiting on it. Fire the callback so the UI updates,
      // then continue to the next chunk instead of aborting the whole batch.
      // (Re-throw cancellation immediately.)
      if (error instanceof Error && error.message === '__FETCH_CANCELLED__') {
        throw error;
      }
      // Auth failures (401 / missing token) are systematic — every remaining
      // chunk will fail the same way. Log loudly so an unpriced quote is
      // distinguishable from "scraper found nothing".
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'SCRAPER_AUTH_MISSING' || msg.includes(' 401')) {
        console.warn(`[bunningsScraper] batch chunk ${chunkIndex + 1}/${totalChunks} failed with an AUTH error — prices will be missing: ${msg}`);
      } else {
        console.warn(`[bunningsScraper] batch chunk ${chunkIndex + 1}/${totalChunks} failed: ${msg}`);
      }
      for (const term of chunkTerms) {
        chunkResults.set(term, []);
        allResults.set(term, []);
      }
      // Don't throw — fire callback and continue to next chunk so a single
      // failed chunk doesn't kill the whole quote.
    }

    onChunkComplete?.(chunkResults, chunkTerms, chunkIndex, totalChunks);
  }

  return allResults;
}
