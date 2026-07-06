/**
 * Reconcile-pass prompt construction, shared between the
 * reconcilePricedMaterials endpoint (index.ts) and the offline replay audit
 * (scripts/replayRecentQuotesWithPrices.ts) so the audit exercises the exact
 * prompt production runs — not a paraphrase that drifts.
 */

export interface ReconcileItemCandidate {
  name?: string;
  price: number;
  url?: string;
  description?: string;
  packSize?: number;
  packUnit?: string;
}

export interface ReconcileItem {
  id: string;
  name: string;
  requirement: number;
  requirementUnit: string;
  // Top-N ranked candidates from the price search. Reconciliation
  // picks the best fit by chosenIndex (or rejects all of them).
  candidates: ReconcileItemCandidate[];
}

export interface ReconcileDecision {
  id: string;
  decision: 'apply' | 'estimate' | 'reject';
  chosenIndex?: number;
  estimatedUnitPrice?: number;
  /** Only when the LLM corrected an inflated requirement (REQUIREMENT
   *  SANITY); same units as the stated requirement. */
  correctedRequirement?: number;
  purchaseCount?: number;
  purchaseUnit?: string;
  totalPrice?: number;
  coverageNote?: string;
  confidence?: 'high' | 'medium' | 'low';
  reasoning?: string;
  rejectReason?: string;
}

export function buildReconcilePrompt(
  items: ReconcileItem[],
  jobName?: string,
  jobDescription?: string
): string {
  const jobContextBlock = (jobName || jobDescription)
    ? `JOB CONTEXT — use this to sanity-check that each chosen candidate makes sense for the job. A toilet suite for a kitchen-sink job, or a retaining-wall post for a deck-screw job, is a category mismatch and must be REJECTED, not applied.
Job: ${jobName || '(unnamed)'}
Description: ${jobDescription || '(none provided)'}

`
    : '';

  return `You are a pricing assistant for an Australian tradie quoting tool. For each material row, the tradie has stated their individual-unit requirement (e.g. "600 each nails", "150 m tape", "40 m² paint coverage") and the price-search has returned a RANKED LIST of candidate products (most likely first).

${jobContextBlock}Your job has two parts:
1. Pick the candidate that best matches the requirement (chosenIndex into the candidates array, 0-based). If NONE of the candidates are the right product category, REJECT the row — do not estimate, do not apply a wrong-category candidate.
2. For the chosen candidate, work out how many ACTUAL PURCHASES the tradie should buy, and the resulting total price. Use your general knowledge of Australian hardware and trade products.

DECISION HIERARCHY:
1. CATEGORY GATE first — if the candidate isn't in the same product category as the requirement, it cannot be applied. A "kitchen sink" requirement and a "toilet suite" candidate are NOT the same category, even if both are plumbing. A "deck screw" requirement and a "retaining-wall post" candidate are NOT the same category, even if both are timber/outdoor. Examples of category-compatible vs not:
   - ✅ Same category: kitchen sink ↔ kitchen sink (any brand/size); decking screws ↔ deck/timber screws; cup-head bolt M12 ↔ cup-head bolt M10; flexible water hose ↔ flexible water hose.
   - ❌ Different category: kitchen sink ↔ toilet suite; deck screws ↔ deck boards; gas hose ↔ water tap; tile adhesive ↔ tile grout.
2. Within the right category, prefer "apply" — different brand, slightly different size, alternative material is fine. An apply on an imperfect-but-same-category match is better than an estimate.
3. Use "estimate" only when every candidate is the wrong category but you have a confident general-knowledge price.
4. Use "reject" when every candidate is the wrong category AND the price is uncertain, OR when the only same-category candidate is implausibly priced (see PRICE SANITY below).

For each item, return one of three decisions:
- "apply" — the chosen candidate is in the SAME product category as the requirement (see CATEGORY GATE above) and the price is plausible. Imperfect matches within the same category are encouraged. Examples of valid applies:
  - Exact: "600 nails" + candidates [(1kg tub @ $13.90)] → 340 nails per tub, buy 2, total $27.80, confidence='high'.
  - Brand substitute: "Eco Deck composite fascia" + candidates include [(Ekodeck fascia 5.4m), (PermaTimber fascia 5.4m)] → apply the closest; confidence='medium'.
  - Spec substitute: "Cup Head Bolt M12 x 150mm" + candidates include [(Cup Head Bolt M12 x 120mm), (Cup Head Bolt M10 x 150mm)] → apply the closest size; confidence='medium'.
  - Length substitute: "Decking screws 50mm" + candidates include [(Decking screws 65mm box of 500)] → apply, confidence='medium'.
- "estimate" — every candidate is the wrong category, but you can give a confident AU-market price from general knowledge so the row isn't $0. Examples:
  - "Eco Deck Starter Clips" + candidates all decking boards → estimate ~$12 per 15-pack, confidence='low'.
  - "Composite Fascia Screws" + candidates all unrelated boards → estimate ~$25 per 100-pack, confidence='low'.
  Always flag it as an estimate in the reasoning ("All candidates were boards, not screws; estimate based on typical AU pricing — verify with supplier").
- "reject" — every candidate is the wrong category AND you have no confident price, OR every same-category candidate is implausibly priced. Set rejectReason explaining the mismatch (e.g. "Job is a kitchen sink replacement but all candidates were toilet suites").

REQUIREMENT SANITY — before computing purchaseCount, sanity-check the requirement count itself against the job description. Round 1 sometimes emits wildly inflated quantities (10×–100×) that the tradie would never actually buy. Use the job's structural anchors (lengths, areas, counts) to bound what's reasonable, then CORRECT the requirement when it's obviously wrong:

- A "5m × 2m deck" needs ~22 decking boards (2m ÷ ~90mm spacing), not 223. ~500 deck screws (≈1 box), not "100 packs". 4–6 footings, not 60.
- A "20m colorbond fence" needs ~9 bays / ~18 posts / ~3 bags concrete per post (≈30 bags), not 200 of anything.
- A "single garden gate" needs 1 latch, 1 pair hinges. Not 10.
- Units in "pack" or "box" are almost always wrong when the requirement count is also >5 — the model meant individual items. Treat "100 pack of screws" as "100 screws total" or, more likely, "~1 box of 500 covers it".

Decision rule: if the requirement is more than ~3× a structurally-derived ballpark for the described job:
1. Set decision="apply" with a CORRECTED purchaseCount that reflects what the tradie should actually buy (derived from the job's structural anchors), AND set correctedRequirement to your corrected requirement (same units as the stated requirement).
2. Use confidence: "medium" (you corrected it; the tradie should verify).
3. In reasoning, write a one-sentence note like "Requirement of 223 boards inflated for a 10 m² deck — corrected to 22 boards (5m × 2m at 90mm spacing)."
4. The client will replace m.quantity with your purchaseCount, so the final quote shows the correct number.

If you can't tell whether the requirement is inflated (no structural anchor in the job description), trust the requirement and proceed normally.

COVERAGE CONSISTENCY — purchaseCount must COVER the requirement: purchaseCount × (units covered per purchase) ≥ requirement, using correctedRequirement instead when you set it. A requirement of "7 each" posts needs 7 posts bought, whatever their length — never 3 because 7 was misread as metres. Under-buying silently underprices the tradie's quote; double-check the arithmetic in your reasoning before finalising purchaseCount.

PRICE SANITY — before applying, check the candidate's per-purchase price against typical AU retail for the requirement. If the chosen candidate is more than ~3× a sensible price for that product (e.g. a $946 "kitchen sink" candidate when typical kitchen sinks are $150–$500, or a $400 "PTFE tape" candidate when tape is $5–$10), REJECT instead of applying. The job description above is your strongest signal of what "sensible" means for this row.

CRITICAL — units must be compatible with the chosen candidate. If requirement is in "each" (count of items) but the product is sold by length/weight/volume, work out the conversion (nails per kg, screws per box, paint coverage per litre) using general knowledge. If you can't confidently convert, set confidence: "low" and explain in reasoning.

PREFER cheaper or smaller pack candidates when they cover the requirement adequately — don't pick the most expensive option just because it's first in the list.

Respond with ONLY valid JSON in this exact shape:
{
  "results": [
    {
      "id": "<material id>",
      "decision": "apply" | "estimate" | "reject",
      "chosenIndex": <number — 0-based index into the candidates array; only when decision=apply>,
      "estimatedUnitPrice": <number — only when decision=estimate; the per-purchase price you're estimating>,
      "correctedRequirement": <number — ONLY when REQUIREMENT SANITY led you to correct an inflated requirement; the corrected requirement in the requirement's own units>,
      "purchaseCount": <number — how many to buy; required for apply and estimate>,
      "purchaseUnit": "<one of: pack, each, m, m², L, kg>",
      "totalPrice": <number — purchaseCount × unit price>,
      "coverageNote": "<one short sentence: what one purchase covers (e.g. '500 screws per box', '5.4m per length', '10L covers ~120 m²', 'estimated 15 clips per pack')>",
      "confidence": "high" | "medium" | "low",
      "reasoning": "<one short sentence justifying the choice and the maths>",
      "rejectReason": "<only when decision=reject: one sentence on why no estimate could be made>"
    }
  ]
}

Items to reconcile:
${JSON.stringify(items, null, 2)}

Return ONLY the JSON object, no other text.`;
}
