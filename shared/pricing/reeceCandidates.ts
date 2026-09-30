/**
 * Reece search answers → pipeline candidates.
 *
 * The searchReeceProduct endpoint returns Reece's own product shape (plus the
 * reauth / not-connected error markers). This mapping used to live inside the
 * app's reeceApi client; it moved here so the server-side pricing run, which
 * calls the search internals directly, produces identical candidates.
 */

import type { ReeceCandidate } from './types';
import { parsePackInfo, type PackInfo } from './parsePackInfo';
import { applyPackAwarePricing, unresolvedPackNote } from './packAwarePricing';
import { roundToTwoDecimals } from './money';
import type { Material } from './types';

export function mapReeceSearchResponse(searchData: any): ReeceCandidate[] {
  if (!searchData) return [];
  if (searchData.error === 'reece_reauth_required') {
    return [{ price: null, reauthRequired: true }];
  }
  if (searchData.error === 'reece_not_connected') {
    return [{ price: null, notConnected: true }];
  }

  const products: any[] = Array.isArray(searchData.products)
    ? searchData.products
    : searchData.product
      ? [searchData.product]
      : [];

  const results: ReeceCandidate[] = [];
  for (const product of products) {
    const price = product.unitPriceIncludingGst ?? product.unitPriceExcludingGst;
    if (price == null) continue;
    // Cache-sourced results carry their own productUrl (built from the
    // description because the price-file's productCode lives in a different
    // ID space than reece.com.au's web search). Live results don't, so we
    // fall back to the legacy itemNumber query.
    const productUrl = product.productUrl
      || `https://www.reece.com.au/search?query=${encodeURIComponent(product.itemNumber)}`;
    results.push({
      price,
      productName: product.description,
      store: 'Reece Plumbing',
      itemNumber: product.itemNumber,
      imageUrl: product.imageUrl ?? null,
      productUrl,
      unitOfMeasure: product.unitOfMeasure || null,
      unitPriceExcludingGst: product.unitPriceExcludingGst ?? null,
    });
  }
  return results;
}

/** Reece units of measure that mean one purchase holds many pieces. */
const MULTI_COUNT_UOM = new Set(['BAG', 'PACK', 'PKT', 'BOX', 'CTN', 'CARTON', 'TUB']);
/** Reece units of measure that mean one purchase is a stock length. */
const LENGTH_UOM = new Set(['LEN', 'LENGTH', 'COIL', 'ROLL']);
/** Reece units of measure that mean the price is per metre. */
const PER_METRE_UOM = new Set(['M', 'MTR', 'MTRS', 'METRE', 'LM']);

/**
 * What one Reece purchase contains, read from the unit of measure plus the
 * description, or null when it says nothing a title parse wouldn't.
 *
 * Reece states the pack in its OWN shapes. A bag of 100 clips is
 * "Sharkbite Pex Clip Masonry Nail 16mm (100)" with UOM BAG, and no
 * title rule reads a bare "(100)", so a 100-clip requirement was priced as
 * 100 bags ($2,305 for $23 of clips). The paren count is only trusted
 * when the UOM already says the purchase is a multi-piece pack, because in
 * a general title a bracketed number is as likely a model code as a count.
 */
export function reecePackHint(
  productName: string | undefined,
  unitOfMeasure: string | null | undefined,
): PackInfo | null {
  const uom = (unitOfMeasure || '').trim().toUpperCase();
  if (!uom) return null;
  if (PER_METRE_UOM.has(uom)) return { packSize: 1, packUnit: 'm' };
  if (MULTI_COUNT_UOM.has(uom)) {
    const counts = [...(productName || '').matchAll(/\((\d{1,5})\)/g)]
      .map((m) => parseInt(m[1], 10))
      .filter((n) => n >= 2);
    if (counts.length) return { packSize: Math.max(...counts), packUnit: 'each' };
    const parsed = parsePackInfo(productName);
    return parsed && parsed.packUnit === 'each' ? parsed : null;
  }
  if (LENGTH_UOM.has(uom)) {
    const parsed = parsePackInfo(productName, { preferUnit: 'm' });
    return parsed && parsed.packUnit === 'm' ? parsed : null;
  }
  return null;
}

/**
 * Pack arithmetic for a row just priced from Reece — applyPackAwarePricing fed
 * with what Reece's unit of measure says one purchase holds.
 *
 * One case needs more than that: a container UOM (CTN, BOX, BAG…) whose
 * description gives no count we can read, against a requirement counted in
 * pieces. "Sky Silver Tip Brazing Alloy 11.34kg Box" (CTN) for 12 rods is one
 * box of many rods, and the per-item fallback bought twelve boxes ($2,577).
 * The UOM is positive evidence the purchase is a pack, so it takes the same
 * path a measured requirement does: one purchase, flagged to check coverage.
 */
export function applyReecePackPricing(
  m: Material,
  productName: string | undefined,
  unitOfMeasure: string | null | undefined,
): void {
  applyPackAwarePricing(m, { productName, ...(reecePackHint(productName, unitOfMeasure) ?? {}) });
  const uom = (unitOfMeasure || '').trim().toUpperCase();
  const required = m.requiredQty ?? m.quantity;
  if (
    MULTI_COUNT_UOM.has(uom) &&
    m.packSize === undefined &&
    (m.requiredUnit ?? m.unit) === 'each' &&
    required > 1
  ) {
    m.quantity = 1;
    m.unit = 'pack';
    m.totalPrice = roundToTwoDecimals(m.price);
    m.priceConfidence = 'low';
    const note = unresolvedPackNote(required, 'each');
    m.description = m.description && m.description !== note ? `${note} ${m.description}` : note;
  }
}
