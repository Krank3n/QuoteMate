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
  const required = material.requiredQty;

  let packSize = product.packSize;
  let packUnit = product.packUnit as Material['unit'] | undefined;

  const requiredUnitNormalised = PACK_UNIT_EQUIVALENT[material.unit];

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
    const parsed = parsePackInfo(product.productName);
    const parsedUnitNormalised = parsed ? PACK_UNIT_EQUIVALENT[parsed.packUnit as Material['unit']] : undefined;
    if (parsed && (!requiredUnitNormalised || parsedUnitNormalised === requiredUnitNormalised || !packSize || !packUnit)) {
      packSize = parsed.packSize;
      packUnit = parsed.packUnit;
    }
  }

  const packUnitNormalised = packUnit ? PACK_UNIT_EQUIVALENT[packUnit] : undefined;
  const nominalLengthPerEach = firstMetreLength(`${material.name} ${material.searchTerm || ''}`);
  const lengthEachToMetres =
    material.unit === 'each' &&
    packUnitNormalised === 'm' &&
    nominalLengthPerEach &&
    /track|gutter|downpipe|pipe|conduit|rail|length/i.test(`${material.name} ${material.searchTerm || ''} ${productNameLower}`);
  const effectiveRequired = lengthEachToMetres ? required * nominalLengthPerEach : required;

  const unitsCompatible =
    !!requiredUnitNormalised &&
    !!packUnitNormalised &&
    (requiredUnitNormalised === packUnitNormalised ||
      !!lengthEachToMetres ||
      (/pointing|compound|mortar|adhesive/i.test(`${material.name} ${productNameLower}`) &&
        ((requiredUnitNormalised === 'L' && packUnitNormalised === 'kg') ||
         (requiredUnitNormalised === 'kg' && packUnitNormalised === 'L'))));

  if (packSize && (packSize > 1 || lengthEachToMetres) && packUnit && unitsCompatible) {
    const packsNeeded = Math.max(1, Math.ceil(effectiveRequired / packSize));
    material.quantity = packsNeeded;
    material.unit = packUnit === 'm' || packUnit === 'm²' || packUnit === 'm³' ? 'each' : 'pack';
    material.packSize = packSize;
    material.packUnit = packUnit;
  } else {
    material.quantity = required;
    material.packSize = undefined;
    material.packUnit = undefined;
  }
  material.totalPrice = roundToTwoDecimals(material.quantity * material.price);
}

function firstMetreLength(s: string): number | null {
  const m = s.match(/\b(\d+(?:\.\d+)?)\s*m\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n > 0 && n <= 20 ? n : null;
}
