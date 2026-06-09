# Agent 5 — Named labour-rate presets ($/100 m²)

Feature ref: Jesse #7.

## What Jesse said
> Labour for ceilings is normally $1500. For floor $2500 per 100M2. I need
> the ability to alter this on every job prior to sending quote. but if i
> could select these rates. then alter before sending. after adding my
> product that would be best. this is what tradify do.

## Goal
A small library of named labour-rate presets the tradie can drop onto a
quote with one tap, then nudge before sending. Each preset stores:
- name
- amount per coverage unit (e.g. $1500 per 100 m²)
- the unit + denominator (m² / 100, lm / 50, sqm / 10, …)

When applied to a quote, the preset multiplies the amount by the quote's
measured area to produce a labour total. The user can still tweak the
final labour figure on the preview screen.

## Data model (additive only)

In `src/types/index.ts`:

```ts
// A reusable labour-rate preset attached to a BusinessSettings record.
// Pricing model: `amount` dollars per `denominator` of `unit`.
// Example: ceiling preset = { amount: 1500, denominator: 100, unit: 'm²' }
//   → $1500 per 100 m². 240 m² job → labour total $3,600.
export interface LabourRatePreset {
  id: string;
  name: string;             // e.g. "Ceiling insulation"
  amount: number;           // dollars (ex GST)
  denominator: number;      // typically 100
  unit: 'm²' | 'm' | 'each' | 'm³';
  notes?: string;           // optional internal note shown in the picker
}
```

Append to `BusinessSettings`:
```ts
labourRatePresets?: LabourRatePreset[];
```

Append to `Quote`:
```ts
// Snapshot of the preset applied to this quote. The user can still nudge
// the final labour figure on JobPreviewScreen; we keep both numbers so the
// quote → invoice transition + Xero sync know the original intent.
labourPresetSnapshot?: {
  presetId: string;
  presetName: string;
  amount: number;
  denominator: number;
  unit: string;
  measuredArea: number;      // m² (or m/etc) used to compute the total
  computedLabourTotal: number;
};
```

## Deliverables

### 1. Pure calc + tests
Create `src/utils/labourPreset.ts`:
```ts
export function computeLabourFromPreset(
  preset: LabourRatePreset,
  measuredArea: number
): number  // returns dollars, 2dp rounded
```
Tests in `src/utils/__tests__/labourPreset.test.ts`:
- 240 m² × $1500 / 100 m² = $3,600
- 50 m² × $1500 / 100 m² = $750
- 0 area → 0
- non-finite inputs → 0

### 2. Settings screen
New `src/screens/settings/LabourRatePresetsScreen.tsx`:
- List existing presets with edit / delete / re-order (drag handle).
- "+ New preset" → inline editor: name + amount + denominator + unit picker.
- Seed Jesse's two presets on first visit if the array is undefined:
  - "Ceiling insulation — $1,500 / 100 m²"
  - "Floor insulation — $2,500 / 100 m²"
- Wire into `SettingsScreen.tsx > Business` section (next to Business
  Defaults) and `RootNavigator`.

### 3. Quote-flow integration
In `src/screens/NewQuote/LaborMarkupScreen.tsx`:
- Top of screen: horizontal chip row of presets ("Ceiling $1,500/100 m²",
  "Floor $2,500/100 m²", "+ Manage").
- Tapping a chip:
  - Asks for measured area (m²) via a small inline TextInput (prefilled
    if `Quote.job.measuredArea` exists — see #5).
  - Computes `computeLabourFromPreset(preset, area)`.
  - Sets `Quote.laborTotal` to the computed value, stamps
    `Quote.labourPresetSnapshot` and clears the per-hour `laborHours` /
    `laborRate` (or sets `laborRate = total, laborHours = 1` so the
    existing summary maths still works — pick whichever is least invasive,
    verified against `quoteCalculator.ts`).
  - User can still nudge the labour figure with the existing inputs after
    applying — the snapshot stays for audit.

In `src/components/JobScopeCard.tsx`:
- Show the snapshot as a small badge under the labour line:
  "Ceiling insulation · 240 m² × $1,500 / 100 m²".
- Tap to swap preset or clear.

### 4. PDF
No PDF changes — labour is already rendered. The preset snapshot is
internal only; the customer sees the final dollar figure (or nothing in
flat-rate mode).

## Acceptance
- [ ] `npm test` passes (`labourPreset.test.ts`).
- [ ] First visit to LabourRatePresetsScreen seeds Jesse's two presets.
- [ ] On a quote: pick "Ceiling" + enter 240 m² → labour total = $3,600.
- [ ] Editing labour after applying preserves `labourPresetSnapshot`.
- [ ] Deleting the underlying preset doesn't break existing quotes
      (snapshot remains).

## Out of scope
- Multiple presets stacked on one quote (one preset per quote v1).
- Per-section presets — could come once Sections gain a measured area.
- Region-aware presets (Sydney vs rural).
