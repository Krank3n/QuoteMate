import { describe, it, expect, vi } from 'vitest';
import { withScraperRetry, isTransientScraperError } from './scraperRetry';

describe('isTransientScraperError', () => {
  it('treats the failures that killed audit runs as transient', () => {
    expect(isTransientScraperError(new Error('request to http://x/api/batch-search failed, reason: read ECONNRESET'))).toBe(true);
    expect(isTransientScraperError(new Error('request failed, reason: read ETIMEDOUT'))).toBe(true);
    expect(isTransientScraperError(new Error('getaddrinfo ENOTFOUND generativelanguage.googleapis.com'))).toBe(true);
    expect(isTransientScraperError(new Error('Network request failed'))).toBe(true);
    expect(isTransientScraperError(new Error('Batch scraper returned 503: Service Unavailable'))).toBe(true);
    // A hung request killed by its own AbortController timeout.
    expect(isTransientScraperError(new Error('The user aborted a request.'))).toBe(true);
  });

  it('does not let incidental numbers in a relayed error body block a retry', () => {
    // The replay includes up to 500 chars of response body in the message —
    // an HTML error page mentioning "404" must not defeat a 503 retry.
    expect(
      isTransientScraperError(new Error('Scraper batch 503: <html>page /api/404-handler unavailable</html>')),
    ).toBe(true);
  });

  it('never treats auth, client errors, or cancellation as transient', () => {
    expect(isTransientScraperError(new Error('SCRAPER_AUTH_MISSING'))).toBe(false);
    expect(isTransientScraperError(new Error('Scraper API returned 401: Unauthorized'))).toBe(false);
    expect(isTransientScraperError(new Error('Scraper API returned 400: Bad Request'))).toBe(false);
    expect(isTransientScraperError(new Error('__FETCH_CANCELLED__'))).toBe(false);
    expect(isTransientScraperError(new Error('Search failed'))).toBe(false);
  });
});

describe('withScraperRetry', () => {
  it('recovers from a one-off transient failure', async () => {
    let calls = 0;
    const result = await withScraperRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error('read ECONNRESET');
        return 'ok';
      },
      { backoffMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('gives up after the configured attempts and rethrows the last error', async () => {
    let calls = 0;
    await expect(
      withScraperRetry(
        async () => {
          calls++;
          throw new Error('read ETIMEDOUT');
        },
        { attempts: 3, backoffMs: 1 },
      ),
    ).rejects.toThrow('ETIMEDOUT');
    expect(calls).toBe(3);
  });

  it('does not retry non-transient errors', async () => {
    let calls = 0;
    await expect(
      withScraperRetry(
        async () => {
          calls++;
          throw new Error('Scraper API returned 401: Unauthorized');
        },
        { backoffMs: 1 },
      ),
    ).rejects.toThrow('401');
    expect(calls).toBe(1);
  });

  it('stops retrying when the caller cancels', async () => {
    let calls = 0;
    await expect(
      withScraperRetry(
        async () => {
          calls++;
          throw new Error('read ECONNRESET');
        },
        { backoffMs: 1, shouldAbort: () => true },
      ),
    ).rejects.toThrow('ECONNRESET');
    expect(calls).toBe(1);
  });

  it('reports each retry for logging', async () => {
    const onRetry = vi.fn();
    await withScraperRetry(
      async () => {
        if (onRetry.mock.calls.length < 2) throw new Error('socket hang up');
        return 'ok';
      },
      { backoffMs: 1, onRetry },
    );
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
