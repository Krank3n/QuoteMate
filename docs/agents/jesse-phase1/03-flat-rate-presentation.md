# Agent 3 — Flat-rate presentation mode

Feature ref: Jesse #6 (and underpins #15).

## What Jesse said
> Product pricing needs to always be hidden from the customer, and product
> quantity. I present my quote as a flat rate. I will need to refer to the
> product quantity if the quote is accepted to order from my supplier.

This is **the** wedge against Tradify — they make this painful, we won't.

## Goal
Every quote can be rendered in two modes:
- **Internal** (Jesse's eyes only): full itemisation — materials, qty, unit
  price, labour breakdown, profit indicator. Used for ordering and his CRM
  rollups. Already roughly what the app shows in the editor.
- **Customer** (PDF, email body, acceptance page): a single **flat-rate line**
  with the job description and total. No material rows. No quantities. No
  labour split. Optional inclusions list (bullet points) for scope clarity.

The flag is per-quote with a sensible business default.

## What already exists
- `Quote.showMaterialCosts`, `Quote.showLaborCosts`, `Quote.showLaborBreakdown`
  (see `src/types/index.ts` ~line 248). Hides costs **but still shows row
  names and quantities**. That's the gap.
- `BusinessDefaultsScreen.tsx` already exposes `showMaterialCostsByDefault` /
  `showLaborCostsByDefault`.
- PDF generation: `src/utils/pdfGenerator.ts` reads those flags.
- Preview: `src/screens/NewQuote/JobPreviewScreen.tsx`.

## Deliverables

### 1. Data model (additive only)
In `src/types/index.ts`, add to `Quote` (append, do not reorder):
```ts
// Presentation mode for the customer-facing PDF / email / acceptance page.
// 'itemised'  — current behaviour, respects showMaterialCosts / showLaborCosts.
// 'flatRate'  — collapses everything into a single line: job description + total.
//               Materials and labour are NOT shown to the customer at all.
//               The internal record (used for supplier ordering, profit, CRM)
//               keeps every line.
presentationMode?: 'itemised' | 'flatRate';

// Customer-facing scope summary used when presentationMode = 'flatRate'.
// Bullet points the customer sees instead of line items. Optional.
flatRateInclusions?: string[];

// Single label that appears as the only line on the customer PDF in flat-rate
// mode. Defaults to the job title / first section name.
flatRateLineLabel?: string;
```

Add a matching business default in the BusinessSettings type (find it in
`src/types`, mirror the existing `showMaterialCostsByDefault` pattern):
```ts
defaultPresentationMode?: 'itemised' | 'flatRate';
```

### 2. PDF rendering
In `src/utils/pdfGenerator.ts`:
- Resolve `presentationMode` the same way other flags resolve (quote → business
  default → `'itemised'`).
- When `flatRate`:
  - Skip the materials table entirely.
  - Skip the labour table / labour breakdown entirely.
  - Render a single line item: `{flatRateLineLabel || job.title} ... $total ex GST`.
  - Render `flatRateInclusions` (if any) as a bullet list under the line.
  - Render subtotal/GST/total summary as today (these are the only numbers
    the customer sees).
  - Do **not** show any "Materials Subtotal" / "Labour Total" rows.
- Make sure markup, deposit, T&Cs blocks still render.

### 3. Editor + preview
In `src/screens/NewQuote/JobPreviewScreen.tsx`:
- Add a presentation-mode toggle (segmented control: Itemised / Flat rate) at
  the top of the preview, persisted to the quote.
- When `flatRate`:
  - Render the preview in flat-rate form (mirror the PDF logic).
  - Show an "Internal copy (you only)" expandable section underneath that
    re-renders the full itemised view so Jesse can sanity-check before sending
    and refer to it later for ordering.
  - Show "Customer will see: 1 line — `{label}` — ${total}" badge.
- Editing the `flatRateLineLabel` and `flatRateInclusions` lives in this
  screen as a small editable block.

### 4. InvoiceDisplaySettings + BusinessDefaults
In `src/components/InvoiceDisplaySettings.tsx` and
`src/screens/settings/BusinessDefaultsScreen.tsx`:
- Add a "Default quote presentation" segmented control (Itemised / Flat rate).
- When Flat rate is the default, dim the existing `showMaterialCosts` /
  `showLaborCosts` toggles with a note ("Flat rate hides these automatically").

### 5. PDFTemplateScreen
In `src/screens/settings/PDFTemplateScreen.tsx`, surface a sample preview of
the flat-rate layout so users understand the difference before flipping
the default.

### 6. Acceptance page / email body
- The acceptance link page (search `acceptanceToken` usages) must not leak the
  itemised data. If it currently re-renders the quote from the Quote document,
  branch on `presentationMode` the same way.
- The AI-generated email body (`draftEmailBody`) should not reference material
  line items when flat rate is on. Update the prompt assembly if it currently
  includes them.

## Acceptance
- [ ] Toggle Quote → `flatRate` → PDF preview shows ONE labelled line + total.
      No qty, no per-line price, no labour breakdown.
- [ ] Toggle back → previous itemised view restored, no data loss.
- [ ] Business default flips the toggle on new quotes.
- [ ] Internal expandable section in `JobPreviewScreen` always shows full
      materials/qty so Jesse can place his supplier order.
- [ ] Acceptance page respects the flag.
- [ ] `npm test` passes; add a snapshot test for the flat-rate PDF HTML if a
      pdfGenerator test harness exists.

## Out of scope
- Re-styling the PDF beyond the structural change.
- CRM rollups of total bags / profit per customer (that's #13, separate phase).
- Stock decrement on accept (#18, later).
