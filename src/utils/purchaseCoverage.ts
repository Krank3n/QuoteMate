/**
 * purchaseCoverage — deterministic guard against the "bought N bulk units when
 * one covers the whole job" failure.
 *
 * Real example (quote QU-178011, a 2m × 5m / 10 m² deck):
 *   - Stainless Steel Decking Screws 10G x 50mm → 19 "pack" @ $151.64 = $2,881
 *   - Merbau Decking Oil → 5 "pack" @ $150.54 = $752
 * Both should have been ONE purchase. The reconcile LLM decides how many to buy
 * but is not handed the product's pack/volume size, so for a generic title like
 * "Stainless Steel Decking Screws 10G x 50mm" (no count token) it can read a
 * $151 bulk-tub price as a per-pack price and multiply by a fabricated count.
 * parsePackInfo() can't help either — there is no "Box of 500" in the name.
 *
 * This recomputes a sane purchase count from coverage, but ONLY for the narrow,
 * unambiguous cases where that failure occurs, and the caller only ever clamps
 * DOWN (`count = min(count, sane)`) — so a conservative estimate can never
 * fabricate extra material, never slashes a genuine multi-pack purchase (clips/
 * nails in small cheap packs), and never touches piece-goods (boards, posts,
 * pavers, bolts sold individually).
 */

export interface CoverageInput {
  /** The tradie's underlying requirement BEFORE any pack conversion
   *  (e.g. ~470 screws, or ~3 litres of oil). */
  requirement: number;
  /** Material/product name — used only to classify fastener vs liquid. */
  name: string;
  /** Per-purchase (single product) retail price of the chosen item, inc GST. */
  perPurchasePrice: number;
  /** Real pack/volume size when known (e.g. 500 screws, 10 L). Authoritative. */
  packSize?: number;
}

// Bulk consumables that genuinely come in tubs/boxes/drums priced per bulk unit.
// Deliberately excludes "bolt", "bracket", "anchor", "clip" — those are commonly
// sold individually, so a high price means one expensive item, not a bulk tub.
const BULK_FASTENER_RE = /\b(?:screws?|nails?|brads?|staples?|tek\s*screws?)\b/i;
const LIQUID_RE = /\b(?:oil|sealer|stain|paint|varnish|primer|undercoat|lacquer)\b/i;

// A fastener/liquid product at or above this price is effectively always a bulk
// tub/drum, not a small retail pack — the only signal we have when packSize is
// unknown. Small cheap packs (below this) are left entirely alone.
const BULK_PRICE_FLOOR = 80;

// Conservative coverage assumptions used ONLY when the real size is unknown.
const ASSUMED_SCREWS_PER_TUB = 500;   // a $80+ screw/nail product is a bulk tub
const ASSUMED_SMALL_FASTENER_PACK = 100; // $5–80 fastener product is usually a retail pack/tub
const ASSUMED_BULK_DRUM_LITRES = 10;  // ~$120+ drum of oil/sealer
const ASSUMED_MID_DRUM_LITRES = 4;    // $80–120 tin of oil/sealer

// Below this requirement a small pack obviously suffices for a fastener row, so
// we never assume a bulk tub — leave the existing count untouched.
const MIN_FASTENER_REQUIREMENT_FOR_TUB = 100;

/**
 * Returns a sane purchase count when the row is a clear bulk-fastener / liquid
 * over-buy, or null to signal "leave the existing count alone". Callers should
 * only ever clamp DOWN: `count = Math.min(count, sane)`.
 */
export function coverageSanePurchaseCount(input: CoverageInput): number | null {
  const { requirement, name, perPurchasePrice, packSize } = input;
  if (!(requirement > 0) || !(perPurchasePrice > 0)) return null;

  const isFastener = BULK_FASTENER_RE.test(name);
  const isLiquid = LIQUID_RE.test(name);
  if (!isFastener && !isLiquid) return null;

  // When the real pack/volume size is known it is authoritative — divide by it.
  if (packSize && packSize > 1) {
    return Math.max(1, Math.ceil(requirement / packSize));
  }

  // Unknown size: liquids only intervene when the product is clearly a tin/drum
  // (priced well above a tiny sample/container).
  if (isLiquid && perPurchasePrice < BULK_PRICE_FLOOR) return null;

  if (isLiquid) {
    const drumLitres = perPurchasePrice >= 120 ? ASSUMED_BULK_DRUM_LITRES : ASSUMED_MID_DRUM_LITRES;
    return Math.max(1, Math.ceil(requirement / drumLitres));
  }

  // Fastener with unknown pack size. A $5+ "nails/screws" SKU is almost never
  // one single nail/screw; it's a retail pack/tub. This catches rows like
  // "200 Pryda nails × $12.01" and "100 bugle screws × $17.02" while leaving
  // genuinely individual cheap fasteners alone.
  if (requirement < MIN_FASTENER_REQUIREMENT_FOR_TUB) return null;
  if (perPurchasePrice >= BULK_PRICE_FLOOR) {
    return Math.max(1, Math.ceil(requirement / ASSUMED_SCREWS_PER_TUB));
  }
  if (perPurchasePrice >= 5) {
    return Math.max(1, Math.ceil(requirement / ASSUMED_SMALL_FASTENER_PACK));
  }
  return null;
}
