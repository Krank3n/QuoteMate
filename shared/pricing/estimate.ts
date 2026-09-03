/**
 * The general-knowledge price estimator's answer, normalised.
 *
 * The app's src/services/webSearchPricing.ts keeps its own copy of these two
 * coercions (a cross-package guard test pins them there); this module gives
 * the server-side pricing run the same treatment of the searchMaterialPrice
 * payload. Keep the three in step.
 */

export interface EstimateResult {
  price: number | null;
  productName?: string;
  /** What ONE purchase at this price contains (a 90 m roll, a 20 kg bag).
   *  Without it the pricing pipeline cannot tell a bag price from a per-kg
   *  rate, and multiplies the purchase price by the job's whole requirement. */
  packSize?: number;
  packUnit?: string;
  store?: string;
  url?: string;
  confidence?: 'high' | 'medium' | 'low';
}

/** A pack size is only usable if it is a real positive number. */
export function positivePack(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * The model is asked for ASCII 'm2'/'m3' (a JSON prompt is a poor place to
 * demand superscripts) but every guard downstream compares against the app's
 * canonical 'm²'/'m³'. Unmapped spellings return undefined rather than a
 * lookalike, because a wrong unit is worse than no unit: it lets a pack size
 * divide a requirement it does not measure.
 */
export function normalisePackUnit(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const map: Record<string, string> = {
    each: 'each', ea: 'each', unit: 'each', pack: 'pack', box: 'box',
    m: 'm', lm: 'm', metre: 'm', meter: 'm', metres: 'm', meters: 'm',
    m2: 'm²', 'm²': 'm²', sqm: 'm²', m3: 'm³', 'm³': 'm³',
    kg: 'kg', l: 'L', litre: 'L', litres: 'L', liter: 'L', liters: 'L',
  };
  return map[raw.trim().toLowerCase()];
}

/** Coerce the searchMaterialPrice endpoint's JSON into an EstimateResult. */
export function normaliseEstimateResponse(data: any): EstimateResult {
  return {
    price: data?.price || null,
    productName: data?.productName,
    packSize: positivePack(data?.packSize),
    packUnit: normalisePackUnit(data?.packUnit),
    store: data?.store || 'Hardware Store (AI estimate)',
    url: data?.url,
    confidence: data?.confidence || 'medium',
  };
}
