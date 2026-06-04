/**
 * Candidate ranker — picks the best product from a list of search hits
 * for a given material, taking quality tier and name-match into account.
 *
 * Previously every search path in materialsPipeline.ts just took
 * `candidates[0]`, throwing away the runner-up hits the supplier API or
 * scraper already returned. For "high quality" jobs that meant we always
 * grabbed the cheapest/most-popular SKU because that's how Bunnings sorts
 * by default — see QU-178055 (Kate Nelson kitchen) where a "high quality
 * mixer tap" landed on an $86 budget unit despite the brief asking for
 * premium fittings.
 *
 * This module is a pure post-processing layer: same candidates, smarter
 * pick. No new network calls.
 */

export type QualityTier = 'budget' | 'standard' | 'premium';

/**
 * Minimal candidate shape this ranker needs. Both ScraperProduct (Bunnings)
 * and LocalSearchResult (saved supplier rates / Reece) satisfy this — keep
 * it structural so callers don't have to convert.
 */
export interface RankableCandidate {
  price: number;
  productName?: string;
  brand?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface RankerMaterial {
  name?: string;
  searchTerm?: string;
  qualityTier?: QualityTier;
}

export interface PickOptions {
  /** Job-level tier fallback when the material doesn't carry its own. */
  jobQualityTier?: QualityTier;
}

/**
 * Tiny allowlist of brands that strongly signal a premium tier in Aus
 * trade categories. Kept short and conservative on purpose — the median
 * price band does most of the work; this is just a tiebreaker so a
 * Phoenix tap beats a no-name when both sit above the median.
 */
const PREMIUM_BRANDS = new Set([
  'phoenix',
  'methven',
  'caroma',
  'franke',
  'abey',
  'oliveri',
  'grohe',
  'gessi',
  'brodware',
  'astra walker',
  'fienza',
  'milli',
  'reece',
  'rinnai',
  'bosch',
  'miele',
  'fisher & paykel',
  'smeg',
  'asko',
]);

function isPremiumBrand(brand?: string): boolean {
  if (!brand) return false;
  return PREMIUM_BRANDS.has(brand.trim().toLowerCase());
}

function tokenize(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/**
 * Pick the best candidate for a material from a list of search hits.
 *
 * Returns the first candidate unchanged when the list is 0–1 long (nothing
 * to choose between). Otherwise scores each priced candidate against:
 *  1. Quality tier bias — pull toward the right price band relative to the
 *     candidate set's own median.
 *  2. Search-term token match in the product name.
 *  3. Penalty for "junk" prices far below the median (usually accessories
 *     or replacement parts the scraper mis-ranked).
 *  4. Brand allowlist bonus when the job is premium.
 *  5. Mild confidence tiebreaker (high > medium > low) — matches the
 *     existing rankCandidates() behaviour so we don't regress.
 *
 * Falls back to the first candidate if every candidate is unpriced.
 */
export function pickBestCandidate<T extends RankableCandidate>(
  candidates: T[],
  material: RankerMaterial = {},
  options: PickOptions = {},
): T | null {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const priced = candidates.filter((c) => typeof c.price === 'number' && c.price > 0);
  if (priced.length === 0) return candidates[0];
  if (priced.length === 1) return priced[0];

  const tier: QualityTier = material.qualityTier || options.jobQualityTier || 'standard';

  const sortedPrices = priced.map((c) => c.price).sort((a, b) => a - b);
  const median = sortedPrices[Math.floor(sortedPrices.length / 2)];

  const searchTokens = tokenize(material.searchTerm || material.name);

  const scored = priced.map((c, idx) => {
    let score = 0;

    // 1. Tier bias — pull toward the right price band.
    //    Use a 30% band around the median for "standard", and prefer
    //    >= median for premium, <= median for budget.
    if (tier === 'premium') {
      if (c.price >= median) score += 3;
      else score -= 2;
      // Extra reward for the most expensive priced candidate when
      // premium — covers the case where the median itself is still
      // a mid-tier SKU.
      if (c.price === sortedPrices[sortedPrices.length - 1]) score += 1;
    } else if (tier === 'budget') {
      if (c.price <= median) score += 2;
      else score -= 1;
    } else {
      // standard — prefer items within ±30% of median
      const delta = Math.abs(c.price - median) / Math.max(median, 1);
      if (delta <= 0.3) score += 1;
    }

    // 2. Name-match — every searchTerm token that appears in the
    //    product name is a strong signal we picked the right product
    //    family (e.g. "mixer" should match "Kitchen Mixer Tap" not
    //    "Tap Aerator"). Worth more than tier bias when present.
    if (searchTokens.length > 0) {
      const name = (c.productName || '').toLowerCase();
      const hits = searchTokens.filter((t) => name.includes(t)).length;
      score += hits * 0.75;
    }

    // 3. Junk-price penalty — anything priced under 20% of the median
    //    in a multi-candidate list is almost always an accessory the
    //    relevance ranker mis-grouped. Examples seen in production:
    //    a $4 tap aerator returned alongside $80–$400 mixer taps.
    if (c.price < median * 0.2) score -= 2;

    // 4. Premium brand bonus — only meaningful when the tier asks for it.
    if (tier === 'premium' && isPremiumBrand(c.brand)) score += 2;

    // 5. Confidence tiebreaker — matches the old rankCandidates() order
    //    so callers that depended on confidence-first don't regress.
    if (c.confidence === 'high') score += 0.3;
    else if (c.confidence === 'medium') score += 0.1;

    return { c, score, idx };
  });

  // Stable sort: highest score first, original order as tiebreaker so
  // when scores tie we preserve the supplier's relevance ranking.
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  return scored[0].c;
}
