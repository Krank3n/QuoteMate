/**
 * The analyse step's wire shape and the validation that turns the model's
 * materials list into rows the pipeline can price.
 *
 * Extracted from src/services/llmService.ts so the server-side pricing run
 * validates an analyzeJobDescription payload exactly as the app does — the
 * dedupe, the unit-aware quantity clamp and the sectionMultiplier sanity vote
 * all decide what ends up on the quote.
 */

import type { FloorplanAnalysis, Material } from './types';
import { clampMaterialQuantity } from '../ai/validateAiOutput';
import { normaliseFloorplanAnalysis } from './floorplanNormalise';

export interface LLMMaterial {
  name: string;
  searchTerm: string;
  quantity: number;
  unit: string;
  reasoning?: string;
  section?: string;
  sectionMultiplier?: number;
  // Quality tier inferred from the job description. Drives candidate
  // selection in materialsPipeline (see candidateRanker.pickBestCandidate)
  // — e.g. "premium" pushes the picker toward the high end of the price
  // band instead of always grabbing the cheapest scraper hit.
  qualityTier?: 'budget' | 'standard' | 'premium';
  // Per-unit labour hours for this material's section. The LLM is asked to populate
  // this in the prompt; if it omits it (LLMs are unreliable), MaterialsListScreen
  // falls back to distributing analysis.estimatedHours across sections by multiplier.
  sectionLaborHours?: number;
  // Set by LLM when matched to a user's saved supplier rate.
  savedRateName?: string;
  pricingSource?: string;
  // Set by the analyzeJobDescription backend when the LLM matched this row
  // directly to a Reece catalogue product (Phase 2 price-file flow). When
  // present, price/reeceItemNumber/pricingSource are pre-stamped server-side
  // so the client's pricing pass skips the search round trip.
  reeceProductId?: number;
  reeceItemNumber?: string;
  price?: number;
  imageUrl?: string;
}

export interface LLMResponse {
  materials: LLMMaterial[];
  estimatedHours: number;
  jobSummary: string;
  // Overall quality tier inferred from the job description. Falls back to
  // 'standard' on the consumer side when undefined. Inherited by any
  // material that didn't get an explicit qualityTier of its own.
  jobQualityTier?: 'budget' | 'standard' | 'premium';
  // Geometry read off an attached architectural plan, when one is detected
  // among the photos. Undefined for ordinary site photos / no photos.
  floorplanAnalysis?: FloorplanAnalysis;
}

export const VALID_UNITS = ['each', 'm', 'm²', 'm³', 'L', 'kg', 'box', 'pack'];

/**
 * Find the most common value in an array
 */
function mode(arr: number[]): number {
  const freq = new Map<number, number>();
  let maxCount = 0;
  let modeVal = arr[0];
  for (const v of arr) {
    const count = (freq.get(v) || 0) + 1;
    freq.set(v, count);
    if (count > maxCount) {
      maxCount = count;
      modeVal = v;
    }
  }
  return modeVal;
}

/**
 * Validate and sanitize LLM materials output
 */
export function validateMaterials(materials: LLMMaterial[]): LLMMaterial[] {
  const filtered = materials
    // Remove items missing required fields or with bad quantities.
    // Retail items need a searchTerm to price; saved-rate and Reece-matched
    // rows are priced off savedRateName / reeceProductId and are told by the
    // prompt to leave searchTerm empty, so don't drop those for a blank term.
    .filter(
      m =>
        m.name &&
        m.quantity > 0 &&
        (m.searchTerm || m.savedRateName || m.pricingSource === 'saved_rate' || m.reeceProductId)
    )
    // Clamp and normalise values. Normalise the unit FIRST — the quantity
    // clamp is unit-aware, so an unrecognised unit has to fall back to 'each'
    // before we decide whether a fraction is meaningful.
    .map(m => {
      const unit = VALID_UNITS.includes(m.unit) ? m.unit : 'each';
      return {
        ...m,
        qualityTier:
          m.qualityTier === 'budget' || m.qualityTier === 'standard' || m.qualityTier === 'premium'
            ? m.qualityTier
            : undefined,
        quantity: clampMaterialQuantity(m.quantity, unit),
        sectionMultiplier: m.sectionMultiplier
          ? Math.min(Math.max(Math.round(m.sectionMultiplier), 1), 200)
          : undefined,
        unit,
      };
    });

  // Enforce consistent multiplier per section.
  //
  // The LLM occasionally duplicates a material's quantity into its
  // sectionMultiplier (e.g. emits "100 bags concrete" with multiplier=100),
  // which then gets picked up as the section's "how many work units" count.
  // That blew up section labour by 10×–100× in real quotes, so drop any
  // sectionMultiplier value that exactly equals its own quantity before
  // taking the mode.
  const sectionMultipliers = new Map<string, number>();
  for (const m of filtered) {
    if (!m.section) continue;
    const existing = sectionMultipliers.get(m.section);
    if (!existing) {
      const sectionMats = filtered.filter(x => x.section === m.section);
      const validVotes = sectionMats
        .filter(x => !(x.sectionMultiplier && x.sectionMultiplier === x.quantity))
        .map(x => x.sectionMultiplier || 1);
      const votes = validVotes.length > 0 ? validVotes : [1];
      sectionMultipliers.set(m.section, mode(votes));
    }
  }

  return filtered
    .map(m => {
      if (!m.section) return m;
      return { ...m, sectionMultiplier: sectionMultipliers.get(m.section) };
    })
    // Deduplicate very similar names within same section
    .filter((m, i, arr) => {
      const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const earlier = arr.slice(0, i).find(
        x => x.section === m.section && normalise(x.name) === normalise(m.name)
      );
      return !earlier;
    });
}

/**
 * Coerce the analyzeJobDescription endpoint's JSON into an LLMResponse.
 * The server doesn't dedupe or sanity-check sectionMultiplier values, so
 * without this pass a sentinel-equal-quantity multiplier (e.g. 100 for "100
 * bags concrete") would slip through and blow up section labour totals.
 */
export function normaliseAnalyzeResponse(data: any): LLMResponse {
  const jobQualityTier =
    data.jobQualityTier === 'budget' ||
    data.jobQualityTier === 'standard' ||
    data.jobQualityTier === 'premium'
      ? data.jobQualityTier
      : undefined;
  const floorplanAnalysis = normaliseFloorplanAnalysis(data.floorplanAnalysis);
  return {
    materials: validateMaterials(data.materials || []),
    estimatedHours: Math.max(1, Math.min(data.estimatedHours || 8, 200)),
    jobSummary: data.jobSummary || '',
    ...(jobQualityTier && { jobQualityTier }),
    ...(floorplanAnalysis && { floorplanAnalysis }),
  };
}

/**
 * Convert LLM materials to app Material format
 */
export function convertLLMMaterialsToMaterials(llmMaterials: LLMMaterial[]): (Partial<Material> & { sectionMultiplier?: number; sectionLaborHours?: number; savedRateName?: string; qualityTier?: 'budget' | 'standard' | 'premium' })[] {
  return llmMaterials.map((m) => {
    const multiplier = m.sectionMultiplier || 1;
    let finalQuantity = Math.round(m.quantity * multiplier * 1000) / 1000;
    // Backstop against the per-unit × multiplier explosion, and the ONLY cap
    // that decides what gets stored. validateMaterials caps per-unit qty at
    // 5000 and the multiplier at 200 independently, so their PRODUCT can reach
    // 1M (real stored cases: 500 × 25 = 12,500 and 42,957 "each" decking
    // screws). Bulk units (kg/L/m/m²/m³) can legitimately be large, so only cap
    // discrete COUNT units; the downstream pack-aware + coverage passes then
    // collapse this to the real number of packs to buy.
    // Keep this in step with MAX_DISCRETE_QUANTITY in shared/ai/validateAiOutput:
    // the per-unit ceiling is deliberately set to this same value so a correct
    // whole-job count in a multiplier-1 section is never truncated on the way in.
    const COUNT_UNITS = ['each', 'pack', 'box'];
    if (COUNT_UNITS.includes(m.unit) && finalQuantity > 5000) {
      finalQuantity = 5000;
    }
    // When the backend has already resolved a Reece catalogue match, trust
    // the pre-stamped price/itemNumber/pricingSource — the reece pricing
    // pass in MaterialsListScreen skips materials that already carry these.
    const hasReeceMatch = m.pricingSource === 'api' && !!m.reeceItemNumber && typeof m.price === 'number' && m.price > 0;
    const unitPrice = hasReeceMatch ? (m.price as number) : 0;
    return {
      name: m.name,
      searchTerm: m.searchTerm,
      templateBaseQuantity: multiplier > 1 ? m.quantity : undefined,
      quantity: finalQuantity,
      unit: m.unit as Material['unit'],
      price: unitPrice,
      totalPrice: unitPrice * finalQuantity,
      manualPriceOverride: false,
      ...(m.section && { section: m.section }),
      ...(m.savedRateName && { savedRateName: m.savedRateName }),
      ...(hasReeceMatch && {
        reeceItemNumber: m.reeceItemNumber,
        pricingSource: 'api' as const,
        ...(m.imageUrl && { imageUrl: m.imageUrl }),
      }),
      sectionMultiplier: multiplier,
      ...(m.sectionLaborHours && m.sectionLaborHours > 0 && { sectionLaborHours: m.sectionLaborHours }),
      ...(m.qualityTier && { qualityTier: m.qualityTier }),
    };
  });
}
