# Jesse Phase 1 — Parallel Agent Plan

Branch: `jesse/phase1-flat-rate-coverage-bulk-uplift`

Three agents work in parallel on three of Jesse's top requests. File ownership
is partitioned to avoid merge conflicts. Each agent commits to the branch with
a prefix matching their feature number, e.g. `feat(jesse-1): ...`.

| Agent | Feature | Brief |
|---|---|---|
| 1 | #1 Bulk supplier price uplift (+%) and GST toggle on imported price lists | `01-bulk-price-uplift.md` |
| 2 | #2 Coverage-based bag auto-calc (m² → bags, rounded to pack increments) | `02-coverage-bag-calc.md` |
| 3 | #6 Flat-rate presentation mode (hide line items + quantities from customer, keep internal copy) | `03-flat-rate-presentation.md` |

## File ownership (do not touch outside your lane without coordinating)

**Agent 1**
- `src/services/supplierListImporter.ts`
- `src/services/materialFavorites.ts`
- `src/screens/settings/` — may add a new screen, e.g. `BulkPriceAdjustScreen.tsx`
- Anywhere the supplier-list screen lives (find via `grep -rln SupplierList src/screens`)

**Agent 2**
- `src/screens/NewQuote/MaterialsListScreen.tsx`
- `src/screens/NewQuote/AddMaterialScreen.tsx`
- `src/screens/NewQuote/AddMaterial/*`
- New file: `src/utils/coverageCalc.ts` (+ test)
- Additive-only edits to `FavoriteProductMapping` in `src/types/index.ts` (one optional field; coordinate via PR comment if needed)

**Agent 3**
- `src/utils/pdfGenerator.ts`
- `src/screens/NewQuote/JobPreviewScreen.tsx`
- `src/components/InvoiceDisplaySettings.tsx`
- `src/screens/settings/BusinessDefaultsScreen.tsx`
- `src/screens/settings/PDFTemplateScreen.tsx`
- Additive edits to `Quote` interface in `src/types/index.ts`

## Shared rule
If you need to add a field to `src/types/index.ts`, append it at the end of
the interface with `?` (optional) and a clear comment. Do not reorder existing
fields. Coordinate via short commit messages on the branch.

## Test / verify
- `npm test` (vitest) must pass before each push.
- Manual: spin up the app, run through new-quote flow on iOS sim.
