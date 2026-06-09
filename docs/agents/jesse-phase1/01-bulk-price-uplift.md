# Agent 1 — Bulk supplier price uplift (+%) and GST toggle

Feature ref: Jesse #1.

## What Jesse said
> I'll send you my price list PDF. Please note there is a 5.8% rise that I
> need to apply to all the products now, and 10% GST needs to be added.

## Goal
After importing a supplier price list (or at any time on the supplier book),
Jesse can:
1. Select a supplier (or all items in a group) and apply a percentage uplift
   (e.g. +5.8%) to every unit price in one action. Reversible.
2. Toggle whether stored prices are ex-GST or inc-GST. When flipping ex→inc,
   multiply by 1.10. When flipping inc→ex, divide by 1.10. Per supplier group.

Both actions are bulk operations on `FavoriteProductMapping` records.

## Code map
- Type: `FavoriteProductMapping` in `src/types/index.ts` (already has `price`,
  `lastUpdatedAt`). You may add `pricesIncludeGst?: boolean` per record and/or
  on `SupplierGroup`.
- Store: `src/services/materialFavorites.ts` — load/save/bulk-save favourites.
- Importer: `src/services/supplierListImporter.ts` — currently runs after PDF
  extraction. After import, route through the new bulk-adjust helpers if the
  user opts in during the import flow.
- Supplier groups: `src/services/supplierGroupService.ts`.

## Deliverables

### 1. Pure helpers (with unit tests)
Create `src/utils/priceAdjust.ts`:
```ts
export function applyPercentUplift(price: number, percent: number): number
export function convertExToInc(priceExGst: number, gstRate?: number /* default 0.10 */): number
export function convertIncToEx(priceIncGst: number, gstRate?: number): number
```
Round to 2 decimal places. Test with vitest (`src/utils/__tests__/priceAdjust.test.ts`).
Cover: positive %, negative %, 0%, edge cases (0 price, undefined).

### 2. Service-level bulk operations
In `src/services/materialFavorites.ts`, add:
```ts
export async function bulkAdjustFavoritePrices(opts: {
  filter: { supplier?: string; ids?: string[] };
  percentChange?: number;       // e.g. 5.8 for +5.8%
  gstAction?: 'addGst' | 'removeGst' | 'none';
}): Promise<{ updated: number }>
```
- Loads existing favourites, applies adjustments, saves back via existing
  `bulkSaveFavorites` (or equivalent).
- Updates `lastUpdatedAt`.
- Idempotent in the sense that re-applying with the same opts gives consistent
  results (don't double-multiply within a single call).
- Returns count for UI feedback.

### 3. UI
Two surfaces:

**(a)** During import (`supplierListImporter` flow / wherever the user is
shown the extracted rows before save), add two optional controls just above the
"Save" CTA:
- "Apply price increase %" numeric input (default empty).
- "Prices are" segmented control: `Ex GST` / `Inc GST` (drives whether +10% is
  added on save when business GST mode requires inc-GST storage).

**(b)** New settings screen `src/screens/settings/BulkPriceAdjustScreen.tsx`
reachable from the supplier book / `SettingsScreen.tsx`. Lets Jesse pick a
supplier group and run the same adjustment later (the 5.8% rise scenario).
- Confirmation modal showing "X items will be updated".
- Show a "Last adjusted: <date> (+5.8%)" line per supplier group (store a tiny
  audit field on `SupplierGroup`, e.g. `lastPriceAdjustment?: { percent: number; at: string; }`).

### 4. Wire it up
Add a nav entry from `SettingsScreen.tsx` → `BulkPriceAdjustScreen.tsx`.
If the supplier price list screen already exists (search
`grep -rln "supplier" src/screens`), add an inline "Adjust all prices" button
there too.

## Acceptance
- [ ] Importing Jesse's PDF then tapping "+5.8%" updates every row in one call.
- [ ] Toggling Ex→Inc on a supplier multiplies every stored unit price by 1.10
      and records the GST mode on the group.
- [ ] `npm test` passes, including the new `priceAdjust.test.ts`.
- [ ] Round-trip survives app restart (Firestore-persisted via existing
      favourites pipeline).

## Out of scope
- Per-product manual price editing (already exists).
- Changing the global GST rate (assume 10% AU).
- Surfacing the adjustment in the quote PDF (handled by Agent 3).
