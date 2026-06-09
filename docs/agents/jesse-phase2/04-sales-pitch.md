# Agent 4 — Sales-pitch intro/outro blocks on every quote

Feature ref: Jesse #4.

## What Jesse said
> I have 2 different sales pitches I use. This is the most common I will
> need built on top of all my quotes. as well as my logo. … Second sales
> pitch I need to tap into is below. I just need the ability to alter the
> R value.

Pitch 1 (always-on owner-operator pitch — verbatim):
```
J. Gorman Insulation – Owner Operated, Quality You Can Trust
…
With over 150 ⭐⭐⭐⭐⭐ Google reviews, my work speaks for itself.
```

Pitch 2 (R-value upgrade calculation):
```
Upgrading your existing R{{existing_R}} insulation by adding R{{added_R}}
will bring your total rating up to R{{total_R}}. …
```

## Goal
A reusable "quote intro / outro" block stored per business, with
template variables. Each quote optionally picks one pitch (or "none") and
fills the variables. The selected pitch renders on the customer-facing
PDF + email body + acceptance page, above the line items.

Logo rendering on PDFs is already done in `pdfGenerator.ts` →
`prepareLogoHtml` — nothing new there.

## Data model (additive only)
In `src/types/index.ts`:

```ts
// A reusable sales-pitch template attached to a BusinessSettings record.
// Rendered above the line items on customer-facing PDFs + email bodies.
// Variables use {{double_curly}} syntax. The set of available variables
// is documented per-pitch via `variables`.
export interface SalesPitch {
  id: string;
  name: string;                       // user-visible label
  body: string;                       // markdown / plain text. {{var}} substitution.
  variables?: SalesPitchVariable[];   // ordered list of fillable variables
  isDefault?: boolean;                // pre-selected on new quotes when no override
}

export interface SalesPitchVariable {
  key: string;                        // matches {{key}} in body
  label: string;                      // input label
  type: 'text' | 'number';
  defaultValue?: string;
  // Optional derived expression — e.g. total_R = existing_R + added_R.
  // Implemented as a small whitelist of arithmetic ops over other variable
  // keys. Phase 2 implements `add`; future agents can add `mul`/`sub`/`div`.
  derive?: { op: 'add'; from: string[] };
}
```

Append to `BusinessSettings`:
```ts
salesPitches?: SalesPitch[];          // user's library of reusable pitches
```

Append to `Quote` (and mirror on `Document` + adapter, same pattern as
Phase 1):
```ts
pitchId?: string;                          // which pitch to render. '' or undefined = none.
pitchVariableValues?: Record<string, string>; // resolved values used at send time
pitchRenderedBody?: string;                // snapshot of the body after substitution
```

## Deliverables

### 1. Pure helpers + tests
Create `src/utils/salesPitch.ts`:
```ts
export function resolvePitchVariables(
  pitch: SalesPitch,
  overrides: Record<string, string>
): Record<string, string>
export function renderPitch(pitch: SalesPitch, resolved: Record<string, string>): string
```
- `resolve` fills defaults, applies overrides, then evaluates `derive.add`.
  Derived values are computed last and can read any other resolved value.
- `render` performs `{{key}}` substitution. Unknown vars render as empty
  string and are logged via `console.warn`.
- Tests: `src/utils/__tests__/salesPitch.test.ts` covering:
  - default substitution
  - override wins over default
  - derive: existing_R = "2", added_R = "4.1", total_R should resolve to "6.1"
  - HTML-escaping happens in the PDF builder (test that `render` returns raw text)

### 2. Settings screen
New `src/screens/settings/QuotePitchScreen.tsx`:
- List existing pitches with rename / edit / delete / set-default.
- "+ New pitch" → editor screen / sheet:
  - Name input.
  - Multi-line body input with a "Insert variable" affordance (chip row).
  - Variables editor: rows of {key, label, type, default, derive}.
  - Default-toggle.
- Pre-seed Jesse's two pitches on first visit if none exist — guarded by
  `salesPitches === undefined`. Seeds:
  - "Owner-operator (default)" — Pitch 1 verbatim, no variables, isDefault: true.
  - "R-value upgrade" — Pitch 2 verbatim, variables [
      { key: 'existing_R', label: 'Existing R-value', type: 'number', defaultValue: '2' },
      { key: 'added_R',    label: 'Adding R-value',   type: 'number', defaultValue: '4.1' },
      { key: 'total_R',    label: 'Total R-value',    type: 'number', derive: { op: 'add', from: ['existing_R', 'added_R'] } },
    ].
- Wire into `SettingsScreen.tsx > Documents` section + RootNavigator.

### 3. JobPreviewScreen integration
In `src/screens/NewQuote/JobPreviewScreen.tsx`:
- New "Sales pitch" card (use the existing card chrome). Shows:
  - Picker: None / each saved pitch / "Manage pitches…"
  - If the chosen pitch has variables: inline inputs with live preview of
    the resolved body.
- On change, write to `Quote.pitchId` + `Quote.pitchVariableValues` and
  persist via the existing updateQuote/saveQuote pair.
- At send time (search `sendQuoteEmail` / acceptance link minting), snapshot
  the resolved body to `Quote.pitchRenderedBody` so later edits to the
  pitch template don't rewrite history.

### 4. PDF renderer
- `shared/pdf/types.ts`: add `pitchHtml?: string` to `QuotePdfData`.
- `src/utils/pdfGenerator.ts`: resolve the pitch (use `pitchRenderedBody`
  when present, else live-resolve from `BusinessSettings.salesPitches`),
  then HTML-escape + paragraph-wrap into `pitchHtml`.
- `shared/pdf/htmlBuilders.ts`: in `buildQuotePdfHtml` and
  `buildInvoicePdfHtml`, render `pitchHtml` immediately under the
  customer/job metadata block and above the materials/flat-rate block.
  Use `<div class="sales-pitch">` so themes can style it.

### 5. Acceptance page / email body
- AI email body generator (search `aiEmailBody` / `draftEmailBody`): when a
  pitch is selected, prepend the resolved pitch body to the AI prompt as
  "Tradie's sales pitch (keep verbatim above your generated copy)".
- Acceptance page (search `acceptanceToken` UI): render the pitch
  immediately above the job summary.

## Acceptance
- [ ] `npm test` passes; salesPitch.test.ts covers derive + substitution.
- [ ] First visit to QuotePitchScreen seeds Jesse's two pitches.
- [ ] Selecting pitch 2 + entering R2 / R4.1 renders "total R6.1" in the
      preview AND on the exported PDF.
- [ ] Toggling default updates BusinessSettings.salesPitches and new
      quotes auto-pick it.
- [ ] HTML-escaping prevents `<script>` in a pitch body from executing.

## Out of scope
- Multi-pitch on a single quote.
- Per-customer pitch presets (could come later).
- Image embeds inside the pitch (text + links only for v1).
