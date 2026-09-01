/**
 * Quantity sanity pass, extracted so the paired eval
 * (scripts/bakeoff/quantitySanityAB.ts) exercises EXACTLY the prompt and
 * decision-application production runs — the materialsPrompt/estimatorPrompt
 * discipline. The LLM call stays with the caller; everything around it is
 * pure and testable.
 *
 * Why this pass is under measurement: its prompt already carries the right
 * derivations (posts = ceil(span/centres)+1) but it runs on the flash-lite
 * tier with a "when in doubt, keep" bias, and real quotes shipped 48 posts on
 * a 2x5 m deck and 140 posts on a 24 m fence straight through it.
 */
import { detectLaunderedSections, clampMaterialQuantity } from './shared/ai/validateAiOutput';

export interface SanityIndexedMaterial {
  index: number;
  name: string;
  quantity: number;
  unit: string;
  section?: string;
  sectionMultiplier?: number;
  // detectLaunderedSections takes the loose AiMaterial shape.
  [key: string]: unknown;
}

export function indexMaterialsForSanity(materials: any[]): SanityIndexedMaterial[] {
  return materials.map((m, i) => ({
    index: i,
    name: m.name,
    quantity: m.quantity,
    unit: m.unit,
    section: m.section,
    sectionMultiplier: m.sectionMultiplier,
  }));
}

export function buildQuantitySanityPrompt(
  jobDescription: string,
  tradeContext: any,
  indexed: SanityIndexedMaterial[],
): string {
  const tradeLine = tradeContext?.nicheName
    ? `${tradeContext.categoryName || ''} / ${tradeContext.nicheName}`.trim()
    : tradeContext?.categoryName || 'general trade';
  const laundered = detectLaunderedSections(indexed);
  const launderBlock = laundered.length
    ? `

OVERRIDE — THE FOLLOWING SECTIONS WERE NOT DERIVED AND MUST BE RECALCULATED: ${laundered.map((s) => `"${s}"`).join(', ')}
Several materials in each carry the SAME round placeholder quantity against a large sectionMultiplier. That multiplier is the job's SIZE, so every one of those lines is about to be multiplied into it — a 165 m² roof emitted this way becomes 165 sheets, 165 batten screws AND 165 tubes of sealant.
For EVERY material in those sections, return "adjust" with a newQuantity derived from real geometry. This overrides the "when in doubt, keep" rule above — in these sections, keeping is the wrong answer:
- Sheet / roll goods: area ÷ the product's cover width or roll coverage.
- Linear goods (ridge capping, edging, trim, battens, flashing): the EDGE or RIDGE length, never the area.
- Consumables (sealant, adhesive, primer, oil): a per-job count or a coverage rate. A few tubes for a whole roof, not one per m².
- Fasteners: a per-m² or per-intersection density × the area.
Remember the quantity you return is PER UNIT of sectionMultiplier, so divide your whole-job figure by ${laundered.length === 1 ? 'that multiplier' : 'the section multiplier'}. Two materials of different physical kinds must NOT come out at the same number. A fractional newQuantity is valid and expected here.`
    : '';

  return `You are reviewing a materials list generated for an Australian tradie's job. The first-pass LLM sometimes over-spec's repeating elements by 3-10× (e.g. 60 deck joists when a 50m² deck only needs 12). Your job: review each material's quantity against the job scope and adjust any that are clearly excessive.

Job description: "${jobDescription}"
Trade: ${tradeLine}

Materials list (with index):
${JSON.stringify(indexed, null, 2)}

For each material, decide:
- "keep" — quantity is reasonable for the scope (within 30% over for waste is fine).
- "adjust" — quantity is clearly excessive (roughly 2× or more over what the scope requires). Reduce to a sensible count.

Use general structural-counting knowledge that applies across all trades:
- Repeating linear elements (joists, studs, posts, rafters): count = ceil(span / centres) + 1.
- Per-area elements (clips, tiles, sheets, downlights, GPOs): count = area × density.
- Linear material from area (decking, weatherboard, cladding): linear metres = area / element_width.
- One-per-unit items: count = N units × items_per_unit.
- Volumetric (concrete bags, sand): bags = volume / yield.
- If quantity has a sectionMultiplier (per-unit qty × multiplier), multiplier is the count of repeating WORK UNITS — sanity-check the multiplier itself against the scope.
- Units "m", "m²", "m³", "kg" and "L" are continuous measures, so a FRACTIONAL newQuantity is valid and often correct — one deck footing is 0.054 m³ of concrete, not 1. Only "each", "pack" and "box" must be whole numbers. Never round a per-unit volume or mass up to 1 just to make it an integer; in a section with a large multiplier that multiplies straight into the quote.

CRITICAL — be conservative. A 20-30% over-spec is normal for waste; do NOT adjust those. Only adjust when the count is clearly disproportionate. When in doubt, keep.${launderBlock}

Respond with ONLY valid JSON in this exact shape:
{
  "results": [
    { "index": <number>, "decision": "keep" | "adjust", "newQuantity": <number when adjust>, "reasoning": "<one short sentence>" }
  ]
}`;

}

/** Apply keep/adjust decisions to the materials array (mutates copies the caller passes). */
export function applySanityDecisions(materials: any[], results: any[]): any[] {
  const adjustments = new Map<number, number>();
  for (const r of results) {
    if (
      r &&
      typeof r.index === 'number' &&
      r.decision === 'adjust' &&
      typeof r.newQuantity === 'number' &&
      r.newQuantity > 0
    ) {
      // Unit-aware, same as the client. A corrective pass that rounds
      // 0.054 m³ to 0 (or floors it to 1) would re-create the very bug it
      // exists to catch — see clampMaterialQuantity.
      const unit = typeof materials[r.index]?.unit === 'string' ? materials[r.index].unit : 'each';
      const clamped = clampMaterialQuantity(r.newQuantity, unit);
      if (clamped > 0) adjustments.set(r.index, clamped);
    }
  }
  if (adjustments.size === 0) return materials;
  return materials.map((m, i) => {
    const adjusted = adjustments.get(i);
    return adjusted !== undefined ? { ...m, quantity: adjusted } : m;
  });
}