// Niches whose core materials can't be reliably auto-priced from Bunnings/Reece
// and warrant a supplier price-list import. Keyed `${categoryId}:${nicheId}`.
// Field-validated: 22m Colorbond fence mis-prices in both local + backend modes.
//
// Kept flat and niche-keyed rather than a per-template flag: several templates
// share a niche, and the flag is computed even when no template matched, so a
// per-template flag would flicker on and off as the blurb resolves differently.
export const SPECIALIST_SUPPLY_NICHES: ReadonlySet<string> = new Set([
  'other:fencing',
  // Ready-mix by the m³, reo bar and slab mesh are all routed away from retail
  // search by tradeFallback — they come off a batching plant or a steel rack.
  'other:concreting',
  // Plasterboard / villaboard / cement sheet: same routing, trade-centre stock.
  'other:gyprock',
  // Bagged render and sand by the m³ price off the trade table, not a shelf SKU.
  'other:rendering',
  // Roof sheet is roll-formed to length at a roofing centre; cladding sheet is
  // already refused retail search for the same reason.
  'roofing:roof_install',
]);

export function isSpecialistSupplyNiche(categoryId?: string, nicheId?: string): boolean {
  if (!categoryId || !nicheId) return false;
  return SPECIALIST_SUPPLY_NICHES.has(`${categoryId}:${nicheId}`);
}
