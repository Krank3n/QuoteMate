// Niches whose core materials can't be reliably auto-priced from Bunnings/Reece
// and warrant a supplier price-list import. Keyed `${categoryId}:${nicheId}`.
// Field-validated: 22m Colorbond fence mis-prices in both local + backend modes.
export const SPECIALIST_SUPPLY_NICHES: ReadonlySet<string> = new Set([
  'other:fencing',
]);

export function isSpecialistSupplyNiche(categoryId?: string, nicheId?: string): boolean {
  if (!categoryId || !nicheId) return false;
  return SPECIALIST_SUPPLY_NICHES.has(`${categoryId}:${nicheId}`);
}
