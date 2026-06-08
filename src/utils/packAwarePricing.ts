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
  if (!packSize || !packUnit) {
    const parsed = parsePackInfo(product.productName);
    if (parsed) {
      packSize = parsed.packSize;
      packUnit = parsed.packUnit;
    }
  }

  const requiredUnitNormalised = PACK_UNIT_EQUIVALENT[material.unit];
  const packUnitNormalised = packUnit ? PACK_UNIT_EQUIVALENT[packUnit] : undefined;
  const unitsCompatible =
    !!requiredUnitNormalised &&
    !!packUnitNormalised &&
    requiredUnitNormalised === packUnitNormalised;

  if (packSize && packSize > 1 && packUnit && unitsCompatible) {
    const packsNeeded = Math.max(1, Math.ceil(required / packSize));
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
