# Scope lines are unreachable from the AI path

**Status:** investigated, not started · **Raised:** 17 Aug 2026, off the back of PR #87 (scope line items)

## The gap

PR #87 gave the app a work item — a line with a title, a multi-line scope paragraph and one lump-sum price — and a two-column **Project Scope** PDF that renders when every line on the document is one. It was built for Lucas Painting and Decorating, and for every labour-dominant trade behind him.

**Exactly one place in production creates a work item:**

```
src/components/InlineAddMaterialRow.tsx:349   kind: 'work'
```

That is the manual `Material | Work item` chip. Nothing in the AI generation path emits one. Nothing in Mate emits one.

So the feature is only reachable by building the list by hand:

| Path | Produces | PDF the customer gets |
|---|---|---|
| **"Build the gear list for me"** (hero CTA on the empty state) | materials | four-column **Materials** table |
| **Mate** → `propose_draft_quote` → `analyzeJobDescription` | materials | four-column **Materials** table |
| **"I'll build it myself"** → Work item chip | work items | two-column **Project Scope** ✅ |

The hero CTA is the primary path — `src/screens/NewQuote/materialsEmptyState.ts` notes it as the point where 40% of first quotes historically stalled. A painter who follows it lands back in exactly the table that made Lucas give up.

---

## Why "just have the AI fill in `scope`" is the wrong shape

Three things block the obvious version.

### 1. The only free text the AI emits is derivation math

Per-material output (`functions/src/index.ts:2095-2110`) is `name`, `searchTerm`, `quantity`, `unit`, `section`, `sectionMultiplier`, `sectionLaborHours`, `qualityTier`, `reasoning`, `planBasis`, `savedRateName`, `pricingSource`, `reeceProductId`.

`reasoning` is the only prose, and the prompt asks for arithmetic in it:

> "Why this material is needed AND the derivation math for any per-area, per-volume, or repeating-unit quantity (e.g. 'Pavers: 25m² ÷ 0.16m²-per-paver × 1.1 waste = 172')."

It is already mapped to `Material.description` at `src/services/materialsPipeline.ts:498` — the pipeline-owned field that gets overwritten at 15 sites and never reaches the PDF (this is why PR #87 added a separate `scope` field rather than reusing `description`). Piping `reasoning` into `scope` would print waste calculations on a customer's quote.

**There is no customer-facing per-line prose in the AI output today.**

### 2. A work item is mostly a price, and the AI is barred from pricing

`src/services/assistant/toolSchemas.ts:186` — `propose_draft_quote`:

> "You do NOT compute materials, quantities, or prices — the existing materials + pricing pipeline handles that on Apply."

A work item's entire content is a title, scope text, and one number the tradie typed. The AI can produce two of the three. An AI-generated work item arrives at **$0** — landing straight back in the "unpriced" state PR #87 spent five guards exempting (`priceFetchGate`, `quoteReview`, `validateAiOutput`, `asPriced`, `MaterialItemCard`).

### 3. Partial adoption buys nothing

```ts
// shared/pdf/htmlBuilders.ts
isScopeQuote = real.length > 0 && real.every((m) => m.kind === 'work')
```

`every`. A quote mixing AI work items with AI materials renders the four-column table regardless. The AI would have to commit per *quote*, not per line — which means a decision about what kind of document this job is, made before the materials are known.

---

## Option A — section descriptions (recommended first)

**Feasibility: 🟢 small. Risk: low. No pricing implications.**

PR #87 added `QuoteSection.description` and renders it under the section heading on the PDF. **Nothing populates it.** The only writer is `createSection` (`src/utils/sectionsModel.ts:112`) when a human types one; the pipeline never sets it.

The AI already names sections confidently — "Colorbond Fence Bay", "Merbau Deck Section", "Concrete Footings". Adding a customer-facing `sectionDescription` beside the existing `sectionMultiplier` / `sectionLaborHours` would make grouped **material** quotes read like a scope document, without touching `isScopeQuote`, without touching pricing, and without changing which table renders.

Touch points:
- `functions/src/index.ts` — add `sectionDescription` to the per-material schema (~:2101) with an explicit "customer-facing, no arithmetic, no internal notes" instruction; mirror in `src/services/llmService.ts` `createPrompt`
- `src/services/materialsPipeline.ts:249-320` — carry it onto the synthesised `QuoteSection`
- Both PDF mappers already pass sections through; `buildScopeHTML` already renders the description

This is the cheap win and it stands alone.

## Option B — let labour-dominant trades produce scope lines

**Feasibility: 🟡 real design work. Not a prompt tweak.**

For the AI to emit work items it needs a price, which means one of:

- **B1** — the pipeline derives it: `sectionLaborHours × multiplier × rate` becomes the work item's `totalPrice`. Keeps the AI out of pricing. Collides with the prompt's hard rule that *"EVERY section MUST have sectionLaborHours > 0"* and with the invariant that a lump sum carries **no** hours (`laborHours === 0 && laborRate === 0`) — a section can't be both.
- **B2** — the AI prices the line directly. Contradicts the stated architecture and loses the supplier-priced grounding that the whole pipeline exists to provide.

It also needs a **mode decision per quote**: is this a materials job or a scope job? Probably trade-derived (`BusinessSettings.tradeCategories`) plus something in the job description, but that is a product call, not an implementation detail.

Worth noting while here: the per-m² allow-list at `functions/src/index.ts:2143` — *"PER-AREA SURFACE-COVERING SECTIONS ONLY (paving installation, tiling, plastering, rendering, screeding)"* — has **no painting entry**, and gives hours-per-m² for all five but none for paint. So even the materials path is weakest for the exact trade this feature was built for. Whatever direction is taken, that line wants revisiting.

---

## What NOT to do

- **Don't map `reasoning` to `scope`.** It is derivation math and it is already claimed by `description`.
- **Don't reuse `Material.description`** as the customer-facing channel. `materialsPipeline` owns it and overwrites it on every reprice — that is the trap PR #87 documented on the `scope` field.
- **Don't have the AI emit work items without solving the price**, or every AI scope quote arrives at $0 and the guards make that state invisible rather than loud.
- **Don't relax `isScopeQuote` to "any work item"** to make partial output render. A tradie with 30 materials and one work item would lose their quantity and unit-price columns.

## Tests this needs

Repo rule: named, written, passing cases; no ticket ships on tsc-green.

**Option A**
- `sectionDescription` survives the AI response → `QuoteSection.description` → PDF
- a section with a description but no materials still renders
- the description is escaped, and newlines become `<br>` (reuse `formatMultiline`)
- a response omitting it leaves existing quotes byte-identical (golden-string, as PR #87 did)

**Option B (in addition)**
- an AI-generated work item carries a non-zero price, or is rejected
- a document of all AI work items renders the Project Scope table
- a mixed AI response renders the four-column table and loses no line
- lump-sum invariant holds: no hours, no rate, no markup (extends `src/utils/__tests__/lumpSumSections.test.ts`)

## Open questions

1. Should the mode be trade-derived, description-derived, or an explicit choice on the empty state — a third option beside "Build the gear list for me" and "I'll build it myself"?
2. For B1, does a scope-line section keep `sectionLaborHours` internally (so the tradie can still see hours) while presenting a lump sum, or is that the same "two sources of truth for one number" that `healBrokenLabourSections` exists to clean up after?
3. Does Mate need to hand off differently, or does it inherit whatever `analyzeJobDescription` decides?

## Related

- PR #87 — scope line items, honest sections, customer-facing detail mode
- `JESSE_FEEDBACK_ANALYSIS.md` #6, #15 — flat-rate presentation, the same customer need from the insulation side
