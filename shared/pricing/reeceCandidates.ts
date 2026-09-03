/**
 * Reece search answers → pipeline candidates.
 *
 * The searchReeceProduct endpoint returns Reece's own product shape (plus the
 * reauth / not-connected error markers). This mapping used to live inside the
 * app's reeceApi client; it moved here so the server-side pricing run, which
 * calls the search internals directly, produces identical candidates.
 */

import type { ReeceCandidate } from './types';

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
