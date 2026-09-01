// Pack-aware pricing utility. Extracted from MaterialsListScreen so the
// shared pricing pipeline (materialsPipeline.ts) can use the same logic.
// Decides whether a fetched product's pack size should divide the user's
// requirement into "packs needed", or whether the requirement is already in
// pack units and shouldn't be divided.

import { Material } from '../types';
import { parsePackInfo } from './parsePackInfo';
import { roundToTwoDecimals } from './documentCalculator';

/**
 * Maps each Material unit to its base unit for equivalence checking. Pack
 * division only applies when the requirement unit is compatible with the
 * pack unit (each↔each, m↔m, m²↔m², m³↔m³, kg↔kg, L↔L). Without this guard,
 * a "60 each" concrete-bag requirement priced against a "20kg" SKU would
 * divide 60/20=3 bags — wrong, because "60 each" already means 60 bags.
 */
export const PACK_UNIT_EQUIVALENT: Partial<Record<Material['unit'], Material['unit']>> = {
  each: 'each',
  pack: 'each',
  box: 'each',
  m: 'm',
  'm²': 'm²',
  'm³': 'm³',
  kg: 'kg',
  L: 'L',
};

export function applyPackAwarePricing(
  material: Material,
  product: { productName?: string; packSize?: number; packUnit?: string },
): void {
  if (material.requiredQty === undefined) {
    material.requiredQty = material.quantity;
  }
  // Record the requirement's own unit before pack conversion overwrites
  // `unit` with a purchase unit ('each'/'pack') — reconcile and coverage
  // guards need to know what requiredQty actually counts.
  if (material.requiredUnit === undefined) {
    material.requiredUnit = material.unit;
  }
  const required = material.requiredQty;

  let packSize = product.packSize;
  let packUnit = product.packUnit as Material['unit'] | undefined;

  // Compare against the REQUIREMENT's unit, not `material.unit` — the two stop
  // agreeing the moment a first pass converts the row, because that pass
  // overwrites `unit` with a purchase unit ('pack'/'each'). Reading `unit` here
  // made this function non-idempotent: re-pricing an already-converted row saw
  // 'pack' → 'each', found it incompatible with the product's 'kg', and fell to
  // the no-division branch — which sets quantity = requiredQty outright. On
  // QU-178692's successor that turned a 440 kg concrete requirement into 440
  // BAGS ($4,048 of quick-set for an 11-bay fence). requiredUnit is captured
  // just above precisely so the original unit survives the mutation.
  const requiredUnitNormalised = PACK_UNIT_EQUIVALENT[material.requiredUnit ?? material.unit];

  // Prefer pack info compatible with the material requirement. Scrapers can
  // surface secondary coverage/yield values (e.g. concrete bag description says
  // "yields 1.1L") even though the purchasable pack is "10kg" in the title.
  // If the supplied pack unit is missing OR incompatible, parse the product
  // title and use it when it matches the requirement unit.
  const productNameLower = (product.productName || '').toLowerCase();
  const suspiciousSuppliedEachPack =
    packUnit === 'each' &&
    packSize &&
    packSize > 100 &&
    !/\b(?:pack|box|pcs?|pieces?|jar|tub|carton|case)\b/i.test(product.productName || '');
  const suppliedPackUnitNormalised = packUnit ? PACK_UNIT_EQUIVALENT[packUnit] : undefined;
  if (suspiciousSuppliedEachPack || !packSize || !packUnit || (requiredUnitNormalised && suppliedPackUnitNormalised !== requiredUnitNormalised)) {
    // Ask the title for a reading in the unit we actually need. Titles state
    // the pack more than one way — "Earthwool R2.0 Wall Batt … 16.0m² 32 Pack"
    // is a 32-piece pack AND 16 m² of coverage — and taking the count against
    // an m² requirement left the units incompatible, which used to mean the
    // bag price got charged once per m² (21 × $97.87 = $2,055 of batts).
    const parsed = parsePackInfo(product.productName, { preferUnit: requiredUnitNormalised });
    const parsedUnitNormalised = parsed ? PACK_UNIT_EQUIVALENT[parsed.packUnit as Material['unit']] : undefined;
    if (parsed && (!requiredUnitNormalised || parsedUnitNormalised === requiredUnitNormalised || !packSize || !packUnit)) {
      packSize = parsed.packSize;
      packUnit = parsed.packUnit;
    }
  }

  const packUnitNormalised = packUnit ? PACK_UNIT_EQUIVALENT[packUnit] : undefined;
  const nominalLengthPerEach = firstMetreLength(`${material.name} ${material.searchTerm || ''}`);
  const lengthEachToMetres =
    (material.requiredUnit ?? material.unit) === 'each' &&
    packUnitNormalised === 'm' &&
    nominalLengthPerEach &&
    /track|gutter|downpipe|pipe|conduit|rail|length/i.test(`${material.name} ${material.searchTerm || ''} ${productNameLower}`);
  const effectiveRequired = lengthEachToMetres ? required * nominalLengthPerEach : required;

  const unitsCompatible =
    !!requiredUnitNormalised &&
    !!packUnitNormalised &&
    (requiredUnitNormalised === packUnitNormalised ||
      !!lengthEachToMetres ||
      (/(?:pointing|compound|mortar|adhesive|marking\s+paint|spray\s+paint|line\s+marking)/i.test(`${material.name} ${productNameLower}`) &&
        ((requiredUnitNormalised === 'L' && packUnitNormalised === 'kg') ||
         (requiredUnitNormalised === 'kg' && packUnitNormalised === 'L'))));

  // A pack of exactly one is still pack info when it is measured — a "1L" tin
  // says the purchase covers 1 litre, so a 10 L requirement is ten tins. The
  // old `packSize > 1` test read that as "no pack info" and fell through to
  // charging the tin price once per litre. Left as `> 1` for 'each', where a
  // "1 each" reading carries nothing.
  const packSizeUsable =
    !!packSize && (packSize > 1 || !!lengthEachToMetres || (packSize === 1 && !!packUnit && MEASUREMENT_UNITS.has(packUnit)));

  // Does the product say it's a pack at all, in ANY unit? Distinguishes "this
  // is a pack we couldn't map onto the requirement" from "we know nothing about
  // how this is sold", which want opposite fallbacks below.
  const knownToBeAPack = !!packSize || !!parsePackInfo(product.productName);

  if (packSizeUsable && packSize && packUnit && unitsCompatible) {
    const packsNeeded = Math.max(1, Math.ceil(effectiveRequired / packSize));
    material.quantity = packsNeeded;
    material.unit = packUnit === 'm' || packUnit === 'm²' || packUnit === 'm³' ? 'each' : 'pack';
    material.packSize = packSize;
    material.packUnit = packUnit;
    material.totalPrice = roundToTwoDecimals(material.quantity * material.price);
    return;
  }

  // No reconcilable pack, and the requirement is an amount rather than a count.
  // `material.price` is the price of ONE purchasable item — that is what every
  // supplier, saved-price and API path hands us — so multiplying it by metres,
  // kilos, litres or square metres invents money. It is how an 11 m underlay
  // roll became 8 × $47.71.
  //
  // Collapsing to a single purchase is only safe when the title gives positive
  // evidence the product IS a pack (a size we simply couldn't map onto the
  // requirement's unit). With no pack reading at all we know nothing, and
  // assuming one purchase covers the job is the more dangerous guess: a
  // "Treated Pine Framing H3 90x45mm" title states no length, and 231 lineal
  // metres would collapse from ~$1,781 to $23. So flag it and leave the money
  // alone — being visibly uncertain beats being confidently short.
  const requirementUnit = material.requiredUnit ?? material.unit;
  if (MEASUREMENT_UNITS.has(requirementUnit)) {
    material.priceConfidence = 'low';
    material.description = withCoverageNote(material.description, required, requirementUnit);
    material.packSize = undefined;
    material.packUnit = undefined;
    if (knownToBeAPack) {
      material.quantity = 1;
      material.unit = 'pack';
      material.totalPrice = roundToTwoDecimals(material.price);
      return;
    }
    material.quantity = required;
    material.totalPrice = roundToTwoDecimals(required * material.price);
    return;
  }

  // Genuinely per-item: the requirement was already counted in pieces, so the
  // product price multiplies out correctly. Unchanged.
  material.quantity = required;
  material.packSize = undefined;
  material.packUnit = undefined;
  material.totalPrice = roundToTwoDecimals(material.quantity * material.price);
}

/** Units that measure an amount rather than count purchasable items. */
const MEASUREMENT_UNITS: ReadonlySet<Material['unit']> = new Set(['m', 'm²', 'm³', 'kg', 'L']);

/** Row note for a price we could only read as a single purchase. */
export function unresolvedPackNote(required: number, unit: Material['unit']): string {
  const qty = Number.isInteger(required) ? String(required) : String(Math.round(required * 100) / 100);
  return `Priced as one purchase — check it covers ${qty} ${unit}.`;
}

function withCoverageNote(existing: string | undefined, required: number, unit: Material['unit']): string {
  const note = unresolvedPackNote(required, unit);
  return existing && existing !== note ? `${note} ${existing}` : note;
}

function firstMetreLength(s: string): number | null {
  const m = s.match(/\b(\d+(?:\.\d+)?)\s*m\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n > 0 && n <= 20 ? n : null;
}
