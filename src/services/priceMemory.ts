/**
 * Price memory — the plumbing that turns a price a tradie types (or tells
 * Mate) into a Supplier Book entry the NEXT quote will use.
 *
 * Why this exists: 64% of sent quotes carry a hand-corrected price, yet none
 * of those corrections reached the book unless the tradie ticked "Save to
 * book" — and even then the entry was written without `isPersonalRate`, which
 * BOTH consumers (the estimator prompt's saved-rates block and the local
 * pre-pricing search) filter on. So the corrections were typed once per quote
 * and thrown away.
 *
 * GST basis: the book holds prices AS THE SUPPLIER QUOTES THEM, GST-inclusive
 * — every reader (materialsPipeline's local pass, AddMaterialScreen's pick)
 * runs them through supplierPriceForGstMode on the way onto a quote. A row's
 * price is in the document's display basis, so an ex-GST business's typed
 * $22.00 must be stored as $24.20 or it comes back as $20.00 next time.
 *
 * Every write goes through bulkSaveFavorites so an entry the tradie already
 * curated (imported supplier name, keywords, notes) keeps those fields and
 * only takes the new price.
 */
import type { FavoriteProductMapping, Material } from '../types';
import { roundToTwoDecimals } from '../utils/documentCalculator';
import { bulkSaveFavorites } from './materialFavorites';
import { invalidateSupplierBookCache } from './supplierBook';

/** Sources whose price the pipeline produced rather than the tradie. */
const PIPELINE_SOURCES: ReadonlyArray<Material['pricingSource']> = ['scraper', 'api', 'ai'];

/**
 * A row whose current price came out of the pricing pipeline — the kind of
 * row a tradie corrects. Work items are never priced by the pipeline, and a
 * row the tradie typed themselves already had its chance at the book chip.
 */
function isPipelinePricedRow(m: Material | undefined | null): boolean {
  if (!m || m.kind === 'work') return false;
  if (m.asPriced) return true;
  if (m.origin === 'recommended') return true;
  return PIPELINE_SOURCES.includes(m.pricingSource);
}

/**
 * Should the "Save to book" chip tick itself? Only while editing a
 * pipeline-priced row with a typed price that differs from what the pipeline
 * found. Reverting to the original price un-ticks it again, so a
 * quantity-only edit never freezes a retail price into the book.
 */
export function shouldAutoRememberPrice(initial: Material | undefined, priceText: string): boolean {
  if (!isPipelinePricedRow(initial)) return false;
  const typed = parseFloat(priceText);
  if (!Number.isFinite(typed) || typed <= 0) return false;
  return Math.abs(typed - (initial!.price ?? 0)) > 0.004;
}

/** What the search-result dropdown handed the row, when the tradie adopted one verbatim. */
export interface PickedSupplierResult {
  productName?: string;
  store?: string;
  itemNumber?: string;
}

export interface RememberPriceOptions {
  /** The document's GST mode (keepSupplierPriceInclusive). False = the row price is ex-GST. */
  pricesIncludeGst: boolean;
}

/**
 * The book entry for a priced row. `isPersonalRate: true` is the whole point —
 * without it the entry is invisible to the next quote. The row's searchTerm
 * rides along as a keyword because it is exactly what the pipeline will
 * search for next time.
 */
export function buildRememberedRate(
  material: Material,
  picked: PickedSupplierResult | null | undefined,
  options: RememberPriceOptions,
): (Partial<FavoriteProductMapping> & { productName: string }) | null {
  const name = material.name?.trim();
  if (!name || material.kind === 'work') return null;
  const rowPrice = Number(material.price);
  if (!Number.isFinite(rowPrice) || rowPrice <= 0) return null;
  const price = options.pricesIncludeGst ? rowPrice : roundToTwoDecimals(rowPrice * 1.1);

  const isPickedSupplier = !!picked && picked.productName === material.name;
  const keywords: string[] = [];
  const term = material.searchTerm?.trim();
  if (term && term.toLowerCase() !== name.toLowerCase()) keywords.push(term);

  return {
    productName: name,
    store: isPickedSupplier ? (picked!.store || 'manual') : 'manual',
    unit: material.unit,
    price,
    isPersonalRate: true,
    source: 'manual',
    lastUpdatedAt: new Date().toISOString(),
    ...(isPickedSupplier && picked!.itemNumber ? { itemNumber: picked!.itemNumber } : {}),
    ...(material.productUrl ? { productUrl: material.productUrl } : {}),
    ...(material.imageUrl ? { imageUrl: material.imageUrl } : {}),
    ...(keywords.length ? { keywords } : {}),
  };
}

/**
 * Remember a row's price in the Supplier Book. Best-effort by design: the
 * quote-side save has already happened and a failed book write must never
 * block or fail it. Resolves true when an entry was written locally.
 */
export async function rememberMaterialPrice(
  material: Material,
  picked: PickedSupplierResult | null | undefined,
  options: RememberPriceOptions,
): Promise<boolean> {
  const entry = buildRememberedRate(material, picked, options);
  if (!entry) return false;
  try {
    await bulkSaveFavorites([entry]);
    invalidateSupplierBookCache();
    return true;
  } catch {
    return false;
  }
}
