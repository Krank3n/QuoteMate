/**
 * GST mode resolution.
 *
 * The business's GST situation is stored as two booleans (both snapshotted
 * onto each Quote/Invoice/Document at creation):
 *
 *  - `gstRegistered` — undefined/true means registered (undefined covers
 *    every document created before this field existed). false means the
 *    business is not registered for GST: no GST is calculated or shown,
 *    and documents carry a "No GST has been charged" note.
 *  - `pricesIncludeGst` — only meaningful when registered. true = prices
 *    entered are GST-inclusive (1/11 disclosure), false = ex-GST (+10%).
 *
 * Always branch through this helper rather than reading the booleans
 * directly, so the undefined-means-registered invariant lives in one place.
 */
export type GstMode = 'exclusive' | 'inclusive' | 'none';

export function resolveGstMode(source: {
  gstRegistered?: boolean;
  pricesIncludeGst?: boolean;
}): GstMode {
  if (source.gstRegistered === false) return 'none';
  return source.pricesIncludeGst === true ? 'inclusive' : 'exclusive';
}

/**
 * Supplier catalogues (Reece, Bunnings, LLM fallbacks) return GST-inclusive
 * retail prices. Only exclusive mode strips the GST out of line prices; both
 * inclusive mode and non-registered businesses keep the full inc-GST price —
 * a non-registered tradie pays GST on materials and cannot claim it back, so
 * stripping it would under-price every line by ~9%.
 */
export function keepSupplierPriceInclusive(source: {
  gstRegistered?: boolean;
  pricesIncludeGst?: boolean;
}): boolean {
  return resolveGstMode(source) !== 'exclusive';
}

/** Customer-facing note shown on documents when the business isn't GST-registered. */
export const NO_GST_NOTE = 'No GST has been charged.';
