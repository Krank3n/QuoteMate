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
  /** Unit `packSize` counts. Required before a known pack size may be divided. */
  packUnit?: string;
  /** Unit `requirement` counts, so pack and requirement can be compared. */
  requirementUnit?: string;
  /** The unit the proposed purchase is counted in ('pack', 'box', 'each'). */
  purchaseUnit?: string;
  /** The purchase count under consideration, so the guard can recognise the
   *  "one container per piece" pathology it cannot infer from price alone. */
  proposedCount?: number;
}

/** Compare units by meaning, not spelling: 'm2' and 'm²' are the same unit. */
function normaliseUnit(u: string): string {
  const t = u.trim().toLowerCase();
  if (t === 'm2' || t === 'sqm') return 'm²';
  if (t === 'm3') return 'm³';
  if (t === 'litre' || t === 'litres' || t === 'l') return 'l';
  return t;
}

/**
 * Lines that are a LUMP SUM by trade convention, not a per-unit rate.
 *
 * An "allowance" or a "hire" is one figure covering the whole job — a tradie
 * writing "spoil removal allowance" means one allowance, never one per post.
 * The pricing path treats every row as a unit rate times a count, which turned
 * "Post hole digging - spoil removal allowance, 15 each" into 15 x $1,200 =
 * $18,000 on a $15.6k fence, tripling the materials total on its own.
 *
 * Deliberately narrow. Words like "removal", "digging" or "labour" are NOT
 * here: those genuinely can be per-unit ("core hole drilling, 12 each"), and
 * collapsing them would under-quote real work. Only terms that denote a single
 * lump by convention qualify.
 */
const LUMP_SUM_RE = /\b(?:allowance|hire|provisional\s+sum|pc\s+sum)\b/i;

/** True when the row is a lump sum that must never be multiplied by a count. */
export function isLumpSumRow(name: string): boolean {
  return LUMP_SUM_RE.test(name || '');
}

/** Purchase units that hold MORE THAN ONE piece, so one per piece is absurd. */
const CONTAINER_UNITS = new Set(['pack', 'box']);

/** Units that count discrete purchasable pieces. */
const COUNT_UNITS = new Set(['each', 'pack', 'box']);

// Bulk consumables that genuinely come in tubs/boxes/drums priced per bulk unit.
// Deliberately excludes "bolt", "bracket", "anchor", "clip" — those are commonly
// sold individually, so a high price means one expensive item, not a bulk tub.
const BULK_FASTENER_RE = /\b(?:screws?|nails?|brads?|staples?|tek\s*screws?|(?:wire|lever)\s+connectors?|wago\s+connectors?)\b/i;
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
  const { requirement, name, perPurchasePrice, packSize, packUnit, requirementUnit, purchaseUnit, proposedCount } =
    input;
  if (!(requirement > 0) || !(perPurchasePrice > 0)) return null;

  // A KNOWN pack size is arithmetic, not a heuristic, so it runs BEFORE the
  // fastener/liquid gate below. That gate exists to guard the *guessing*
  // branches — assumed tub and drum sizes — and applying it to a size we can
  // actually read left every non-fastener consumable unclamped: 100 sanding
  // mesh sheets billed at the price of a 10-pack, 100 times over ($10,500
  // against a real $130). Requires the pack to count the same kind of thing as
  // the requirement, so a "20kg" pack never divides a piece count.
  // BOTH units must be stated and countable. Treating an unknown unit as
  // countable read "Treated Pine Post 2.4m" as a 2.4-pack and divided a 7-post
  // requirement down to 3 — an under-buy, the worse failure. A caller that
  // does not supply units gets the pre-existing behaviour below, unchanged.
  const packIsCountable = !!packUnit && COUNT_UNITS.has(packUnit);
  const requirementIsCountable = !!requirementUnit && COUNT_UNITS.has(requirementUnit);
  // Same unit on both sides is exact arithmetic too, and it is the case the
  // COUNT_UNITS pair was too narrow to reach: a pack covering 5 m² against a
  // 38 m² ceiling is 8 packs, no heuristic involved. Restricting the division
  // to countable units left every bulk-unit row (m², m, kg, L) with NO over-buy
  // guard at all — that is how a reconcile hallucination of 475 packs of
  // R4.0 ceiling batts for 38 m² survived every check and billed $42,702.
  // Requiring the units to MATCH is what keeps the old failure out: a "2.4m"
  // pack read against a 7-'each' post requirement has m ≠ each, so it is still
  // refused rather than dividing 7 posts down to 3.
  const sameUnit =
    !!packUnit && !!requirementUnit && normaliseUnit(packUnit) === normaliseUnit(requirementUnit);
  if (packSize && packSize > 1 && ((packIsCountable && requirementIsCountable) || sameUnit)) {
    return Math.max(1, Math.ceil(requirement / packSize));
  }

  const isFastener = BULK_FASTENER_RE.test(name);
  const isLiquid = LIQUID_RE.test(name);
  if (!isFastener && !isLiquid) return null;

  // Known size on a fastener/liquid row whose units did not line up above
  // (e.g. a litre pack against a litre requirement) — still authoritative.
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
  //
  // One container per piece is wrong by definition, whatever the requirement.
  // A row that proposes buying `pack`s or `box`es, one for each piece needed,
  // contradicts itself: a pack holds more than one. That is not a guess from
  // price, so it runs ahead of the requirement gate below — which exists to
  // protect items sold individually whose NAME matches this pattern (a "screw
  // pile", a "nail gun"), and those are counted in 'each', never in packs.
  //
  // Real case, QU-178514: four identical coil-nail rows, same $42.90 product.
  // 400 and 172 pieces clamped correctly to 4 and 2 packs; 72 and 64 sat just
  // under the gate and bought one box per nail — $5,834 of nails on a $15.6k
  // fence. The siblings prove the pack assumption; only the gate differed.
  const buysAContainerPerPiece =
    !!purchaseUnit &&
    CONTAINER_UNITS.has(purchaseUnit) &&
    !!requirementUnit &&
    requirementUnit === 'each' &&
    typeof proposedCount === 'number' &&
    requirement > 1 &&
    proposedCount >= requirement;

  if (requirement < MIN_FASTENER_REQUIREMENT_FOR_TUB && !buysAContainerPerPiece) return null;
  if (perPurchasePrice >= BULK_PRICE_FLOOR) {
    return Math.max(1, Math.ceil(requirement / ASSUMED_SCREWS_PER_TUB));
  }
  if (perPurchasePrice >= 5) {
    return Math.max(1, Math.ceil(requirement / ASSUMED_SMALL_FASTENER_PACK));
  }
  return null;
}

export interface PackInfoSources {
  /** Structured pack size on the chosen candidate — most trustworthy. */
  candidatePackSize?: number;
  candidatePackUnit?: string;
  /** Candidate product name, e.g. "…Concrete Mix 20kg". */
  candidateProductName?: string;
  /** Pack info already stamped on the row by an earlier pricing pass. */
  rowPackSize?: number;
  rowPackUnit?: string;
  /** The reconcile model's own reasoning — it routinely states the pack size
   *  ("20kg per bag, 11 bags total 220kg") even when nothing structured did. */
  rowDescription?: string;
  /** What the reconcile model said about the pack it chose (coverageNote /
   *  reasoning). Ranks below the candidate's own description because it is
   *  prose, but it is often the ONLY statement of coverage when the chosen
   *  product could not be identified — the case that left the R4.0 batts row
   *  with no pack size and therefore no guard. */
  statedByModel?: string;
  /** The material name, which sometimes carries the size itself. */
  rowName?: string;
}

/**
 * Recover a pack size from the best source available, most to least reliable.
 *
 * The coverage floor can only catch an under-buy when it has a pack size to
 * divide by; with none it returns null and the model's purchase count stands
 * unchecked. That is how QU-178692 shipped 11 × 20 kg bags against a 440 kg
 * concrete requirement — the size was there in the model's own reasoning, just
 * never read. Recovering it is safe because every consumer re-checks that the
 * unit matches the requirement before dividing.
 */
export function recoverPackInfo(
  s: PackInfoSources,
  parsePack: (
    text?: string,
    opts?: { proseSource?: boolean },
  ) => { packSize: number; packUnit: string } | null,
): { packSize?: number; packUnit?: string } {
  const fromCandidateName = parsePack(s.candidateProductName);
  // rowDescription and statedByModel are SENTENCES — the model's coverage note
  // or reasoning, or a description bullet — not product titles. They get the
  // prose reading, so a load-rated noun mentioned in passing ("...for the post
  // holes and brackets") can't blank the pack size stated alongside it.
  const fromStated =
    parsePack(s.rowDescription, { proseSource: true }) ??
    parsePack(s.statedByModel, { proseSource: true }) ??
    parsePack(s.rowName);
  return {
    packSize:
      s.candidatePackSize ?? fromCandidateName?.packSize ?? s.rowPackSize ?? fromStated?.packSize,
    packUnit:
      s.candidatePackUnit ?? fromCandidateName?.packUnit ?? s.rowPackUnit ?? fromStated?.packUnit,
  };
}

export interface CoverageFloorInput {
  /** The tradie's underlying requirement (requiredQty), in requirementUnit. */
  requirement: number;
  /** The reconcile LLM's explicit corrected requirement, when it deliberately
   *  corrected an inflated round-1 quantity. Takes precedence. */
  correctedRequirement?: number;
  /** Material name — used to exclude bulk fasteners/liquids (where "each"
   *  never means "one purchase") and to recognise discrete piece-goods. */
  name: string;
  /** Unit the requirement is stated in ('each', 'kg', 'L', 'm', 'm²', 'm³'). */
  requirementUnit?: string;
  /** Chosen candidate's pack size, in packUnit. */
  packSize?: number;
  packUnit?: string;
}

// Discrete structural/piece goods sold one per purchase: a requirement of
// "7 each" posts can never be covered by fewer than 7 purchases. Excludes
// spliceable linear goods (gutter, pipe, conduit) where fewer longer lengths
// legitimately cover an each-requirement. `(?![-–])` keeps "Post-Mix
// Concrete" from reading as a post.
const PIECE_GOOD_RE = /\b(?:posts?(?![-–])|palings?|pickets?|sleepers?|boards?|rails?|plinths?|studs?|joists?|bearers?|rafters?|battens?|lintels?|beams?|panels?|sheets?|bags?)\b/i;

const FLOOR_UNIT_EQUIVALENT: Record<string, string> = {
  each: 'each', pack: 'each', box: 'each',
  m: 'm', 'm²': 'm²', m2: 'm²', 'm³': 'm³', m3: 'm³',
  kg: 'kg', l: 'L', L: 'L',
};

/**
 * Mirror image of coverageSanePurchaseCount: a floor against reconcile
 * UNDER-buys (LLM returns a purchaseCount that cannot cover the requirement,
 * e.g. 3 posts for a 7-post requirement). Returns the minimum purchase count
 * that covers the requirement, or null to signal "can't be computed safely".
 * Callers should only ever raise: `count = Math.max(count, floor)`.
 *
 * Deliberately conservative: bulk fasteners/liquids are excluded (their
 * "each" requirement is divisible into unknown pack sizes), and without a
 * unit-compatible pack size only recognised discrete piece-goods get the
 * one-per-purchase floor.
 */
export function coverageFloorPurchaseCount(input: CoverageFloorInput): number | null {
  const requirement =
    input.correctedRequirement && input.correctedRequirement > 0
      ? input.correctedRequirement
      : input.requirement;
  if (!(requirement > 0)) return null;
  if (BULK_FASTENER_RE.test(input.name) || LIQUID_RE.test(input.name)) return null;

  const ru = input.requirementUnit ? FLOOR_UNIT_EQUIVALENT[input.requirementUnit] : undefined;
  const pu = input.packUnit ? FLOOR_UNIT_EQUIVALENT[input.packUnit] : undefined;

  // Known pack size in the requirement's own units — divide by it.
  if (input.packSize && input.packSize > 0 && ru && pu && ru === pu) {
    return Math.max(1, Math.ceil(requirement / input.packSize));
  }

  // Discrete piece-goods: one purchase covers exactly one required item.
  if (ru === 'each' && PIECE_GOOD_RE.test(input.name)) {
    return Math.max(1, Math.ceil(requirement));
  }

  return null;
}
