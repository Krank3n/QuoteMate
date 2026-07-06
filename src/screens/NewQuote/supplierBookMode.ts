// Supplier Book row behaviour. The book screen serves two entry points:
//
//   1. Settings → "Supplier Book": standalone management, NO active quote.
//      Tapping a row opens it for editing; there is nothing to add to.
//   2. A quote section's "Supplier Book" button (MaterialsListScreen →
//      openSupplierBookForSection): there IS an active quote and a target
//      section (passed as the `section` route param).
//
// Historically both rendered view-only, which forced tradies opening the
// book from a quote to eyeball a price and re-type the item by hand
// (reported by a fencing builder, July 2026). Rows are now addable whenever
// a quote section context exists; the Settings entry stays edit-only.
// Kept pure (no RN imports) so it is unit-testable.

export function savedItemsSelectable(opts: {
  supplierBookOnly: boolean;
  hasQuoteSection: boolean;
}): boolean {
  return !opts.supplierBookOnly || opts.hasQuoteSection;
}
