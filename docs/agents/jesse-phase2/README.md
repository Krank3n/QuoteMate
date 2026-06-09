# Jesse Phase 2 — Parallel Agent Plan

Branch: `jesse/phase2-pitch-labour-starter` (stacked on Phase 1).

Phase 2 finishes Jesse's day-1 quote workflow. After this branch he can
quote in his exact style end-to-end:

  pitch + scope + flat rate total, with sane labour presets and his 11
  insulation line items pre-seeded.

| Agent | Feature | Brief |
|---|---|---|
| 4 | #4 Sales-pitch intro/outro blocks (with R-value variables) | `04-sales-pitch.md` |
| 5 | #7 Named labour-rate presets ($/100 m²) | `07-labour-presets.md` |
| 6 | #14 Insulation starter kit (Jesse's 11 line items seeded) | `14-insulation-starter-kit.md` |

## File ownership

**Agent 4 (#4)**
- New: `src/screens/settings/QuotePitchScreen.tsx`
- `src/types/index.ts` (additive: BusinessSettings.salesPitches, Quote.pitchId)
- `src/utils/pdfGenerator.ts` + `shared/pdf/types.ts` + `shared/pdf/htmlBuilders.ts`
- `src/screens/NewQuote/JobPreviewScreen.tsx` (pitch picker)

**Agent 5 (#7)**
- New: `src/screens/settings/LabourRatePresetsScreen.tsx`
- `src/types/index.ts` (additive: BusinessSettings.labourRatePresets)
- `src/screens/NewQuote/LaborMarkupScreen.tsx`
- `src/components/JobScopeCard.tsx` (preset chips above labour totals)

**Agent 6 (#14)**
- New: `src/services/starterKits/insulation.ts` (seed data)
- New: `src/services/starterKitInstaller.ts` (installs the kit on demand)
- `src/screens/onboarding/*` or new "Starter Kits" entry in
  `SettingsScreen.tsx → Documents` section.

## Shared rule (unchanged from Phase 1)
- Append-only optional fields in `types/index.ts`.
- Run `npm test` before each push.

## Trade-specific patterns to extract
- **Editable quote intro/outro with variables** (#4) — generic primitive.
- **Labour-rate presets** (#7) — generic primitive.
- **Trade starter kits** (#14) — the onboarding moat. Insulation is the
  first; fencing / decking / painting follow the same shape.
