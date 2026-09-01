/**
 * Ground truth for "what do you actually get when you buy ONE of this?".
 *
 * This is the ruler the coverage scorer measures every arm against, so it must
 * NOT be the app's own `parsePackInfo` regex — grading the pipeline with the
 * same regex that produces its errors would score every pack bug as correct.
 * Instead a strong model reads the full product title AND description (the
 * scraper returns no structured packSize/packUnit — pack information exists
 * only as prose), and answers the single physical question.
 *
 * Cached by item number so the ruler is stable across arms and across re-runs:
 * two arms that pick the same SKU are always judged by the same fact.
 */

import * as fs from 'fs';
import * as path from 'path';
import { askJson } from './claude';
import { describe } from './scraper';
import { ProductFacts, ScraperProduct, Unit } from './types';

const CACHE_PATH = process.env.BAKEOFF_FACTS_CACHE || path.resolve(__dirname, '../../../.bakeoff-product-facts.json');

type Cache = Record<string, ProductFacts>;
let cache: Cache | null = null;

function load(): Cache {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as Cache;
  } catch {
    cache = {};
  }
  return cache!;
}

function save(): void {
  if (cache) fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

/**
 * Cache key for a SKU.
 *
 * The scraper returns the literal string "unknown" as itemNumber for products
 * it could not identify. Keying on that collapsed EVERY such product onto one
 * cache entry — a tiling sponge inheriting a multi-tool blade's pack facts —
 * which silently corrupted coverage scoring. Only a genuine identifier is
 * allowed to key; everything else falls back to the product name.
 */
function keyFor(p: { itemNumber?: string; productName: string }): string {
  const item = (p.itemNumber || '').trim();
  const usable = item.length > 0 && item.toLowerCase() !== 'unknown' && item !== '0' && /^[A-Za-z0-9._-]+$/.test(item);
  return usable ? `item:${item}` : `name:${p.productName.toLowerCase().trim()}`;
}

const SYSTEM = `You read Australian hardware/trade product listings and state, precisely, what a single purchase physically yields. You are a measurement instrument: you report what the listing says, never what a job might need.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['products'],
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'yieldAmount', 'yieldUnit', 'piecesPerPurchase', 'confidence', 'note'],
        properties: {
          index: { type: 'integer' },
          yieldAmount: {
            type: 'number',
            description: 'Buying ONE of this gives you this much of yieldUnit. A 20kg bag -> 20. A 2.25m board -> 2.25. A 5-pack of 2.25m boards -> 11.25 (total metres). A single tap -> 1.',
          },
          yieldUnit: { type: 'string', enum: ['each', 'm', 'm²', 'm³', 'kg', 'L'] },
          piecesPerPurchase: {
            type: ['integer', 'null'],
            description: 'Discrete pieces in one purchase ("5 Pack" -> 5, "Box of 500" -> 500). null if not a multi-piece pack.',
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: 'string', description: 'One short clause naming the evidence in the listing, e.g. "title says 20kg".' },
        },
      },
    },
  },
} as const;

function buildPrompt(batch: ScraperProduct[]): string {
  const listing = batch
    .map((p, i) => `[${i}] TITLE: ${p.productName}\n    DESCRIPTION: ${describe(p) || '(none)'}\n    LISTED PRICE: $${p.priceIncGst || p.price}`)
    .join('\n\n');
  return `For each product below, state exactly what ONE purchase yields.

Rules:
- yieldUnit is the unit the product is MEASURED in, not the unit a job might want. A bag of concrete mix is kg. A tin of paint is L. A length of timber is m. A tap, a hinge, a power point is 'each'.
- yieldAmount is the total in that unit for ONE purchase. Multiply through for packs: "5 Pack" of 2.25m boards is 11.25 m, not 2.25.
- A roll or sheet sold by coverage ("20m² roll") is m² with the coverage as the amount.
- If the listing genuinely does not state a size (e.g. "Treated Pine Framing 90x45mm" with no length), set yieldUnit 'each', yieldAmount 1, and confidence 'low' — do NOT guess a standard length.
- confidence 'high' only when the title or description states the size outright.
- FASTENERS AND SMALL CONSUMABLES (nails, screws, brads, staples, clips, plugs, washers) are almost never sold one at a time. If the listing gives a piece count or a pack mass ("1000 Pack", "Box of 500", "500g"), report that count as BOTH yieldAmount (unit 'each') and piecesPerPurchase. Only report yieldAmount 1 for such an item if the listing really is a single piece — and then set confidence 'low'.
- Do not confuse a TOOL with the consumable it uses: a nail gun, a caulking gun or a trowel is 'each', quantity 1, and is not a supply of nails or sealant.

Products:
${listing}`;
}

/** Resolve facts for a set of products, using and filling the cache. */
export async function productFactsFor(products: ScraperProduct[]): Promise<Map<string, ProductFacts>> {
  const c = load();
  const out = new Map<string, ProductFacts>();
  const need: ScraperProduct[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    const k = keyFor(p);
    if (seen.has(k)) continue;
    seen.add(k);
    if (c[k]) out.set(k, c[k]);
    else need.push(p);
  }

  // Batched so one request covers many SKUs, and batches run concurrently:
  // a single job can introduce 200+ unseen SKUs (claude-direct alone invents
  // ~40 search terms), and doing those serially made the ground-truth phase
  // longer than all four arms combined. Reading a pack size out of a title is
  // an easy extraction, so this runs at low effort — spot-checked against the
  // titles, and the scorer tests pin the maths that consumes it.
  const BATCH = 40;
  const CONCURRENCY = 4;

  const batches: ScraperProduct[][] = [];
  for (let i = 0; i < need.length; i += BATCH) batches.push(need.slice(i, i + BATCH));

  const runBatch = async (batch: ScraperProduct[]) => {
    let parsed: { products: any[] };
    try {
      parsed = (await askJson<{ products: any[] }>(buildPrompt(batch), SCHEMA as any, {
        system: SYSTEM,
        cacheSystem: true,
        effort: 'low',
        maxTokens: 24000,
      })).value;
    } catch (err: any) {
      console.warn(`  productFacts batch failed: ${String(err?.message || err).slice(0, 140)}`);
      return;
    }
    for (const r of parsed.products || []) {
      const p = batch[r.index];
      if (!p) continue;
      const facts: ProductFacts = {
        itemNumber: p.itemNumber,
        productName: p.productName,
        yieldAmount: Number(r.yieldAmount) > 0 ? Number(r.yieldAmount) : 1,
        yieldUnit: (r.yieldUnit || 'each') as Unit,
        piecesPerPurchase: r.piecesPerPurchase ?? null,
        confidence: r.confidence || 'low',
        note: r.note,
      };
      const k = keyFor(p);
      c[k] = facts;
      out.set(k, facts);
    }
  };

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(batches.slice(i, i + CONCURRENCY).map(runBatch));
    save();
  }
  return out;
}

export function factsKey(p: { itemNumber?: string; productName: string }): string {
  return keyFor(p);
}
