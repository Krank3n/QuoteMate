# Agent 2 — Coverage-based bag auto-calc (m² → bags)

Feature ref: Jesse #2 (and underpins #15).

## What Jesse said
> I will need an automated calculation built in for speedy quotes. For
> insulation, I will be adding 20 bags, 10, 5 and so on.

## Goal
On the materials step of a quote, when Jesse picks an insulation product
(or any coverage-based material), he enters a single number — the area in m²
— and the app calculates the number of bags (or boxes, sheets, etc.) required,
**rounded up to the next pack increment** (default 1, can be 5/10/20 for bag
deliveries).

## What already exists
- `FavoriteProductMapping.coveragePerUnit` + `coverageUnit` (`'m²' | 'm³' | 'm'`)
  already on the data model (`src/types/index.ts:92-93`).
- `AddMaterialScreen.tsx` / `AddMaterial/ManualEntrySection.tsx` already
  capture coverage when adding/editing a favourite.
- The consumer side (quote line item) does **not** use it yet — that's the gap.

## Deliverables

### 1. Pure calc helper (with tests)
Create `src/utils/coverageCalc.ts`:
```ts
export interface CoverageInput {
  area: number;                // total m² (or m / m³)
  coveragePerUnit: number;     // e.g. 13.5 m² per bag
  roundingIncrement?: number;  // default 1; can be 5, 10, 20 for delivery packs
  wastagePercent?: number;     // optional, default 0 — not in scope for v1 but allow it
}
export interface CoverageResult {
  unitsRequired: number;       // raw m² / coveragePerUnit
  unitsToOrder: number;        // ceil to increment
  coveredArea: number;         // unitsToOrder * coveragePerUnit
  surplus: number;             // coveredArea - area
}
export function calculateUnits(input: CoverageInput): CoverageResult
```
Tests: `src/utils/__tests__/coverageCalc.test.ts`.
- 100 m² / 13.5 per bag → 7.41 → 8 (incr 1), 10 (incr 5), 10 (incr 10), 20 (incr 20).
- Zero/negative area → 0.
- Missing coveragePerUnit → throws or returns 0 (document the choice).

### 2. Optional model field (additive only)
In `src/types/index.ts`, add to `FavoriteProductMapping`:
```ts
roundingIncrement?: number; // bags/boxes delivered in packs of N (default 1)
```
Place it directly after `coverageUnit` with a one-line comment. Do not reorder
existing fields.

Expose it in `AddMaterial/ManualEntrySection.tsx` as a small numeric input
labelled "Order in packs of" shown only when `coveragePerUnit` is set. Default
is empty (treated as 1).

### 3. Quote-side "Calculate from area" affordance
In `src/screens/NewQuote/MaterialsListScreen.tsx`:
- For each material line whose linked favourite has `coveragePerUnit`, show
  a small "↻ m²" button (or inline expandable). Tapping opens a sheet:
  - Input: "Area to cover (m²)" — prefilled from `Quote.job` if a total m² is
    available there (search for an existing field; otherwise leave blank).
  - Shows live preview: "13 bags (covers 175.5 m², surplus 5.5 m²)".
  - "Apply" sets `material.quantity` and `material.requiredQty` accordingly.
- Don't break manual quantity editing — area calc is opt-in.

For Jesse the m² value is also captured at lead capture (#5 — future). For now
just let him type it.

### 4. Integration with AddMaterialScreen
When adding a new material from a favourite that has `coveragePerUnit`, default
the qty entry mode to "By area (m²)" instead of "By quantity". Toggleable.

## Acceptance
- [ ] Vitest passes on `coverageCalc.test.ts`.
- [ ] On a quote, with an R4.1 batt favourite (coveragePerUnit = 13.5 m²,
      roundingIncrement = 10), entering 100 m² produces qty = 10 bags and a
      `totalPrice` consistent with `price × 10`.
- [ ] Existing materials without coverage are unaffected (no UI regression).

## Out of scope
- Wastage % surcharge UI (helper accepts it, UI not required v1).
- Lead-capture total-m² field (Agent for #5 later).
- Showing/hiding bag qty on the customer PDF — Agent 3 owns that.
