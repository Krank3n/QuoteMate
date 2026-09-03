/**
 * scraperRetry — transient-failure retry for supplier search calls.
 *
 * Replay audits kept losing whole quotes to one-off network blips
 * (ECONNRESET/ETIMEDOUT on the scraper droplet), and the production batch
 * path silently degrades on the same blips: a failed chunk marks its terms
 * unpriced, the rows drop to estimates, and the tradie loses real shelf
 * prices for the sake of one dropped socket. A couple of retries with
 * backoff recovers almost all of these.
 *
 * Deliberately NOT retried: auth failures (401/403 — every retry fails the
 * same way), client errors (400/404), application-level "search failed"
 * responses, and cancellation. Retrying those wastes time or masks bugs.
 */

// 'aborted' covers a hung request killed by its own AbortController timeout
// (node-fetch reports "The user aborted a request") — the slow-droplet-hang
// twin of ECONNRESET. Deliberate cancellation never reaches here as an abort:
// callers signal it with __FETCH_CANCELLED__ / shouldAbort instead.
const TRANSIENT_RE =
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EPIPE|network\s+(?:request\s+failed|error)|socket\s+hang\s*up|timed?\s*out|aborted|\b(?:429|502|503|504)\b/i;

// Status codes anchored to the error-message shapes our callers throw
// ("Scraper API returned 401", "Batch scraper returned 403", "Scraper batch
// 404: …") — a bare \b404\b would also match incidental numbers inside a
// relayed HTML error body and wrongly block a legitimate retry.
const NEVER_RETRY_RE = /SCRAPER_AUTH_MISSING|__FETCH_CANCELLED__|(?:returned|batch|status)\s*:?\s+40[134]\b/i;

export function isTransientScraperError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (NEVER_RETRY_RE.test(msg)) return false;
  return TRANSIENT_RE.test(msg);
}

export interface ScraperRetryOptions {
  /** Total attempts including the first (default 3). */
  attempts?: number;
  /** Base backoff in ms; attempt N waits N × base (default 1000). */
  backoffMs?: number;
  /** Polled before each retry — return true to stop retrying (user cancelled). */
  shouldAbort?: () => boolean;
  /** Called before each retry sleep — for logging. */
  onRetry?: (attempt: number, err: unknown) => void;
}

export async function withScraperRetry<T>(
  op: () => Promise<T>,
  options: ScraperRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const backoffMs = options.backoffMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      if (!isTransientScraperError(err)) break;
      if (options.shouldAbort?.()) break;
      options.onRetry?.(attempt, err);
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }
  throw lastErr;
}
