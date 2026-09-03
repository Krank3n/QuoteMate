// Single source of truth for "should the pricing pipeline fetch a price for
// this row?".
//
// History: the pipeline's gates used `!(price > 0 && !manualPriceOverride)`,
// which treats manualPriceOverride=true as "needs re-fetching". Everywhere
// else in the app the flag means the opposite — "the tradie set/locked this
// price, leave it alone" (see quoteReview.ts: override rows are never
// flagged). The inverted gates meant a saved personal rate — or a price the
// tradie typed by hand — was re-fetched and overwritten by the local
// supplier-book and Bunnings passes on the next "Get Prices" run.
//
// The rule now: any row that already has a price is left alone, locked or
// not. Rows that should be re-priced are zeroed first (that's what
// resetFlaggedRowsForReprice does), which routes them back through here.
// A locked row with NO price (tradie typed an item but left the price
// blank) still gets a price fetched — there's nothing to protect yet.

// Work items are never fetched, at any price. A lump-sum scope line ("General
// preparation", "Interior surfaces to be painted") is a title, a paragraph and
// one number the tradie typed — there is no product behind it. A $0 scope line
// would otherwise look exactly like an unpriced material and get shipped to
// the supplier search, which then overwrites the name and the price.
export function needsPriceFetch(m: { price: number; kind?: 'material' | 'work' }): boolean {
  if (m.kind === 'work') return false;
  return !(m.price > 0);
}
