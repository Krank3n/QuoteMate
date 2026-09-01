/**
 * Bunnings scraper client for the bake-off, with an on-disk cache.
 *
 * Every arm must see the SAME candidate set for a given search term, or the
 * comparison measures scrape luck rather than pipeline quality. The cache also
 * makes re-runs cheap and keeps the deterministic scorers reproducible across
 * runs — a live re-scrape days later returns different prices and would move
 * every number.
 */

import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { ScraperProduct } from './types';

const CACHE_PATH = process.env.BAKEOFF_SCRAPE_CACHE || path.resolve(__dirname, '../../../.bakeoff-scrape-cache.json');

type Cache = Record<string, ScraperProduct[]>;
let cache: Cache | null = null;
let dirty = false;

function loadCache(): Cache {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as Cache;
  } catch {
    cache = {};
  }
  return cache!;
}

export function flushCache(): void {
  if (!dirty || !cache) return;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  dirty = false;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function batchSearchLive(terms: string[]): Promise<Map<string, ScraperProduct[]>> {
  const base = (process.env.BUNNINGS_SCRAPER_URL || '').replace(/\/$/, '');
  const key = process.env.BUNNINGS_SCRAPER_API_KEY;
  if (!base || !key) throw new Error('Missing BUNNINGS_SCRAPER_URL / BUNNINGS_SCRAPER_API_KEY');

  const out = new Map<string, ScraperProduct[]>();
  // Chunked like production (materialsPipeline batches in small groups) — the
  // droplet drops oversized batches. Chunks run a few at a time: the scraper is
  // Playwright-backed and a cold ground-truth pass needs ~40 terms, which is
  // minutes of pure waiting when done one chunk after another.
  const chunks: string[][] = [];
  for (let i = 0; i < terms.length; i += 8) chunks.push(terms.slice(i, i + 8));

  const runChunk = async (chunk: string[]) => {
    const searches = chunk.map((searchTerm) => ({ searchTerm, limit: 5, sortBy: 'relevance' }));
    let lastErr: any;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 300_000);
        let res: any;
        try {
          res = await fetch(`${base}/api/batch-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
            signal: controller.signal as any,
            body: JSON.stringify({ searches }),
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) throw new Error(`scraper ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data: any = await res.json();
        for (const item of data.results || []) {
          out.set(item.searchTerm, item.success ? item.results || [] : []);
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < 4) await sleep(3000 * attempt);
      }
    }
    if (lastErr) {
      // A failed chunk records empty results rather than aborting the run —
      // an unpriced row is a real pipeline outcome and should score as one.
      for (const t of chunk) if (!out.has(t)) out.set(t, []);
      console.warn(`  scraper chunk failed after retries: ${String(lastErr?.message || lastErr).slice(0, 120)}`);
    }
    for (const t of chunk) if (!out.has(t)) out.set(t, []);
  };

  const SCRAPE_CONCURRENCY = 3;
  for (let i = 0; i < chunks.length; i += SCRAPE_CONCURRENCY) {
    await Promise.all(chunks.slice(i, i + SCRAPE_CONCURRENCY).map(runChunk));
  }
  return out;
}

/** Cached batch search. Terms already cached are never re-fetched. */
export async function batchSearch(terms: string[]): Promise<Map<string, ScraperProduct[]>> {
  const c = loadCache();
  const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  const missing = unique.filter((t) => !(t in c));
  if (missing.length > 0) {
    const fresh = await batchSearchLive(missing);
    for (const [k, v] of fresh) {
      c[k] = v;
      dirty = true;
    }
    // Guard against a term the scraper never echoed back.
    for (const t of missing) if (!(t in c)) { c[t] = []; dirty = true; }
    flushCache();
  }
  const out = new Map<string, ScraperProduct[]>();
  for (const t of unique) out.set(t, c[t] || []);
  return out;
}

export function normalisedPrice(p: ScraperProduct): number {
  return p.priceIncGst && p.priceIncGst > 0 ? p.priceIncGst : p.price;
}

export function describe(p: ScraperProduct): string {
  const d = Array.isArray(p.description) ? p.description.join('. ') : p.description || '';
  return d.slice(0, 400);
}

/**
 * Coerce the scraper's `description` (a bullet ARRAY in the live payload) to
 * the string its TypeScript type claims. Production does NOT do this — see
 * the bake-off report: the array reaches parsePackInfo via
 * applyReconcileResult and throws, and the pipeline's bare catch then
 * abandons the whole reconcile pass. Used to measure the app with and
 * without that one defect.
 */
export function normaliseDescriptions(products: ScraperProduct[]): ScraperProduct[] {
  return products.map((p) =>
    Array.isArray(p.description) ? { ...p, description: p.description.join('. ') } : p,
  );
}
