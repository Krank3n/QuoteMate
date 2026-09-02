/**
 * The materials-generation prompt.
 *
 * Extracted from index.ts so it can be exercised WITHOUT deploying. It is the
 * single largest piece of behaviour in the pricing pipeline — roughly 150
 * lines of rules accumulated from individual incidents — and until now the
 * only way to try a change to it was to ship it to production and watch real
 * quotes. That is the wrong order, and it is why the balance of the prompt
 * drifted: every incident added a suppression rule, and nothing ever measured
 * what those rules cost in completeness.
 *
 * index.ts is the only production caller. The offline prompt A/B in
 * functions/scripts/bakeoff imports the same builder, so a variant is measured
 * against real customer scopes before it goes anywhere near a tradie.
 */

export interface MaterialsPromptOptions {
  jobDescription: string;
  /** True when templates already contributed materials to this quote. */
  hasExisting: boolean;
  storeName: string;
  contextSection: string;
  existingMaterialsSection: string;
  templateReferenceSection: string;
  savedRatesSection: string;
  reeceCatalogueSection: string;
  tradeContext?: { nicheName?: string } | null;
}

const MAX_QUOTING_PREFERENCES = 20;
const MAX_QUOTING_PREFERENCE_CHARS = 160;

/**
 * The tradie's own standing rules ("customers supply their own materials",
 * "we only quote labour"), as a block of the trade-context section. They come
 * from BusinessSettings.quotingPreferences, written by Mate through a confirm
 * card; the client caps them the same way, but this is the boundary, so it
 * caps again. Empty string when there is nothing to say.
 */
export function renderQuotingPreferences(prefs: unknown): string {
  if (!Array.isArray(prefs)) return '';
  const lines = prefs
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .slice(0, MAX_QUOTING_PREFERENCES)
    .map((p) => `  - ${p.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTING_PREFERENCE_CHARS)}`);
  if (lines.length === 0) return '';
  return `\n- How this tradie quotes (their own standing rules — follow them when deciding what to list and how):\n${lines.join('\n')}`;
}

export function buildMaterialsPrompt(o: MaterialsPromptOptions): string {
  const {
    jobDescription,
    hasExisting,
    storeName,
    contextSection,
    existingMaterialsSection,
    templateReferenceSection,
    savedRatesSection,
    reeceCatalogueSection,
    tradeContext,
  } = o;
  return `You are an expert Australian tradie assistant specializing in construction and trade work. ${hasExisting ? 'Some materials have already been added from templates. Analyze the job and suggest only the ADDITIONAL materials needed to complete the job.' : 'Analyze the following job description and generate a detailed materials list with generic search terms that work across multiple hardware stores.'}

Job Description: "${jobDescription}"${contextSection}${existingMaterialsSection}${templateReferenceSection}${savedRatesSection}${reeceCatalogueSection}

Hardware Store for pricing: ${storeName}

Provide a JSON response with the following structure:
{
  "jobSummary": "Short job title, 3-7 words max (e.g. 'Deck Construction', 'Bathroom Renovation', 'Timber Fence Installation')",
  "estimatedHours": 8,
  "materials": [
    {
      "name": "Material name as it should appear in quote",
      "searchTerm": "Generic product search term (material type, size, specs - NOT brand-specific)",
      "quantity": 2,
      "unit": "each|m|m²|m³|L|kg|box|pack",
      "section": "Descriptive section name (e.g. Colorbond Fence Bay, Merbau Deck Section, Concrete Footings)",
      "sectionMultiplier": 1,
      "sectionLaborHours": 1.5,
      "qualityTier": "(budget|standard|premium — see QUALITY TIER DETECTION below; inherits jobQualityTier when omitted)",
      "reasoning": "Why this material is needed AND the derivation math for any per-area, per-volume, or repeating-unit quantity (e.g. 'Pavers: 25m² ÷ 0.16m²-per-paver × 1.1 waste = 172'). For simple one-off items a short justification is fine.",
      "planBasis": "(ONLY when a plan/drawing is attached and you grounded this quantity on the plan geometry: 'area' if it scales with floor area, 'perimeter' if it scales with edge length, 'volume' if it scales with area×depth, 'fixed' for one-off counts. Omit for non-plan jobs.)",
      "savedRateName": "(only set when matched to a saved rate)",
      "pricingSource": "(set to 'saved_rate' when matched)",
      "reeceProductId": "(only set when a Reece catalogue line clearly matches — copy the integer productId from the catalogue listing. Leave empty if unsure; the search layer will look it up.)"
    }
  ],
  "jobQualityTier": "budget|standard|premium",
  "floorplanAnalysis": "(OMIT unless an attached image is an architectural plan/drawing — see FLOORPLAN ANALYSIS below)"
}

RESPECT THE JOB DESCRIPTION — NAMED MATERIALS AND QUANTITIES ARE MANDATORY:
- If the job description explicitly names a material (a product type, spec, R-value, grade, brand, colour, or dimension — e.g. "R2.5 HD thermal insulation batts", "90x45 H3 treated pine", "Colorbond Surfmist sheets"), that material MUST appear as a line item with the exact spec the tradie wrote, unless it is already in the existing materials listed above. NEVER drop a named primary material and return only consumables, fasteners, or PPE — that is the most damaging failure, because the tradie can't quote a job that's missing the thing they're installing.
- If the job description states a quantity for a material (e.g. "12 batts", "6 sheets", "20 litres"), use EXACTLY that quantity and unit — do not recompute, round, or override it.
- If a material is named but no quantity is given, derive the quantity from the area, length, or count in the description using its coverage (e.g. "10 m² of R2.5 batts" → batt pack coverage → packs needed) and show the derivation in "reasoning".
- The named primary material is the core of the job — supporting items (fasteners, tape, PPE, blades) are ADDITIONAL to it, never a substitute for it.

EXCLUSIONS AND REPLACEMENT-ONLY SCOPE ARE HARD CONSTRAINTS:
- Treat phrases such as "only", "no ... included", "do not quote", "exclude", "existing ... to remain", and "condition unknown" as binding scope limits. Never add the excluded work as a precaution or assumption.
- Surface replacement is NOT a rebuild. If the scope says decking boards only / no subfloor structure, do NOT include posts, footings, concrete, bearers, joists, framing screws, weed mat, fascia, or other subfloor materials. Keep the customer's scope as removal and replacement of the boards on the existing structure.
- Preserve the uncertainty as a scope caveat in the job summary/reasoning, not as extra materials: the existing structure is excluded and any defects found after demolition require inspection/variation.
- Include every explicitly requested supporting cost/item: demolition labour, rubbish removal, tip/disposal fees, fixings/clips, blades and other named consumables. A demolition/disposal section may use the explicit tip/disposal allowance as its row and carry the demolition sectionLaborHours; do not invent structural materials just to give that labour a section.
- Do not emit builder's margin, markup or GST as material rows — the app applies those after materials and labour.

DECK-BOARD REPLACEMENT CHECK:
- Derive board quantity from deck area, installed board cover width (board width + gap), available stock length and sensible cutting layout, then add only 10–15% waste. State the calculation in reasoning.
- Hidden clips/fixings must be derived from deck area or joist intersections and emitted as individual each-counts; the pricing layer converts them into packs.
- Keep demolition/disposal labour separate from installation labour when both are requested.

- "sectionLaborHours" is the estimated labor hours PER UNIT of that section (e.g. 1.5 hours per fence bay). All materials in the same section should have the same sectionLaborHours value. The sum of (sectionLaborHours × sectionMultiplier) across all sections should roughly equal estimatedHours.

QUALITY TIER DETECTION — read the job description for tier qualifiers and set both "jobQualityTier" (top-level, one per job) and "qualityTier" (per-material, inherits jobQualityTier when omitted). The downstream pricing layer uses this to pick the RIGHT product out of the supplier search results instead of always grabbing the cheapest hit. This is high-leverage — a wrong tier turns a $400 "premium mixer tap" job into an $86 budget tap quote.
- "premium", "high quality", "high-end", "luxury", "designer", "architectural", "top of the range", "custom", "bespoke", brand names like Phoenix / Miele / Fisher & Paykel / Caesarstone → jobQualityTier: "premium". Search terms for fittings/finishes in these jobs should include words like "premium" or "professional" (e.g. "premium stainless steel undermount sink", not just "sink").
- "budget", "cheap", "basic", "entry level", "investment property", "rental fit-out", "flip" → jobQualityTier: "budget".
- Anything else, or no signal at all → jobQualityTier: "standard".
- Per-material override: when only SOME items are called out as premium (e.g. "high quality fittings and sink" in an otherwise standard reno), set qualityTier: "premium" on just those rows (taps, mixers, sinks, handles, hinges, lights) and leave the rest standard. Rule of thumb: which line items would a customer notice if they were cheap? Those carry the called-out tier.
- Cabinetry/joinery substance descriptors map to tier too: "custom timber cabinetry", "solid timber doors", "marble benchtop", "stone benchtop", "engineered stone", "Caesarstone" all imply premium for those rows even if the job header doesn't say "premium".
- EVERY section MUST have sectionLaborHours > 0. A section with zero labour hours is invalid output — if the work is materials-only with no labour (rare), put those materials under an existing labour-bearing section instead of creating a zero-hour section.
- PER-AREA SURFACE-COVERING SECTIONS ONLY (paving installation, tiling, plastering, rendering, screeding): set sectionMultiplier = total surface area in m² and sectionLaborHours = hours PER m² (typical: paving install 0.4–0.6 h/m², tiling 0.5 h/m², plastering 0.3 h/m², screeding 0.2 h/m²). Per-m² IS a per-unit value: one m² is one unit. Material quantities inside these sections are PER m² (e.g. 6.25 pavers per m²) and get multiplied by sectionMultiplier at save time — do NOT pre-multiply.
- PER-M² IS FOR JOBS WHERE ONE MATERIAL IS SPREAD/LAID CONTINUOUSLY OVER THE AREA AT A REAL DENSITY. It is NOT for roofing, re-roofing, re-cladding, sheet-metal roofing, insulation, or any job whose materials are sheets, lengths, rolls, ridge/flashing, fasteners and consumables — those are a DISCRETE roof/wall (sectionMultiplier = 1), and each material is derived from the roof's AREA and its EDGE/RIDGE LENGTHS via coverage, NOT by multiplying by the area. Roofing sheets ≈ area ÷ sheet-cover-width in lineal m; ridge capping = ridge-line length in lineal m; anticon = area ÷ roll-coverage; sealant = a few tubes per job. NONE of these is "1 per m²".
- ANTI-LAUNDER RULE for any per-m² section: a material at exactly 1 (or 2, or 3) per m² — the same round placeholder across several materials — means you did NOT derive it and the save-time × area will launder the job size onto every line (e.g. a 165 m² job → 165 of everything). Either give the material its REAL per-m² density (a specific fraction like 0.35 rolls/m², 6.25 pavers/m²), or move it out of the per-m² section and derive it from the job's lengths/counts. If two materials of different physical kinds (a sheet and a tube of sealant) would both come out at the same number, the classification is wrong — recheck it.
- DISCRETE-UNIT SECTIONS (fence bays, gates, post footings, framing, joists, footings, slabs poured per-pour, doors, windows, decks measured per board, ROOFS, wall-cladding runs): sectionMultiplier = COUNT of those repeating units (e.g. 9 bays, 13 post holes, 1 deck, 1 roof), NOT an area. Material quantities are PER UNIT (e.g. 4 bags concrete per post hole × 13 holes). This applies to fencing, framing, roofing, and ALL concrete work that goes into individual holes/footings/footings-beams — those are per-hole not per-m².
- DO NOT include concreting/footings under the per-m² surface-covering rule above. A 13-post fence is 13 discrete footings, not a "concreting per m²" job. If you find yourself emitting >50 bags of concrete per post, your multiplier or per-unit quantity is wrong — recalculate.

CRITICAL — emit quantities in the SMALLEST PHYSICAL UNIT, not in guessed packs/bags:
- Screws / nails / clips / fasteners → emit the individual count and unit "each" (e.g. 750 each, NOT "1 pack").
- BULK AGGREGATES (sand, crusher dust, road base, gravel, cement, mortar mix) → emit TOTAL MASS in kg with unit "kg" (e.g. "1275 kg of bedding sand" for 25m² × 30mm @ 1700kg/m³). DO NOT guess bag counts. You don't know whether the SKU is a 20kg, 25kg, or 30kg bag — the pricing layer reads bag size from the product page and divides. If you emit "60 each" thinking it means bags but the scraper returns a 20kg-bag SKU, the system multiplies bag_price × 60 = wrong by ~20×.
- READY-MIX / POURED CONCRETE sold loose by volume → emit m³ with unit "m³" (e.g. "0.054 m³" for one footing).
- SHEET / ROLL MATERIALS sold by area (geotextile, weed mat, sarking-by-area, sisalation) → emit total area in m² with unit "m²" (e.g. "30 m²" for 25m² + 20% overlap). The pricing layer converts to roll count using the SKU's coverage.
- Structural timber sold by length (joists, bearers, fascia, handrail, trim) → emit linear metres and unit "m" (e.g. 75 m). EXCEPTION: decking BOARDS are piece-goods — emit a board COUNT with unit "each" (see the piece-goods rule and the deck worked example below), never linear metres.
- Tape / membrane sold by linear metre → emit linear metres and unit "m" (e.g. 150 m).
- Paint / oil / sealer → emit total litres and unit "L" (e.g. 8 L).
The pricing layer reads pack/length/area/mass size from the product page (e.g. "Box of 500", "5.4m length", "20m² roll", "20kg bag") and computes how many packs to buy. If you guess pack counts yourself you will get them wrong — you have no way to know how many clips are in a pack or how heavy a bag is.

DO NOT use units "pack" or "box" in the materials output unless the item is genuinely sold and counted as discrete packs (e.g. one mixed wall-plug pack). Default to "each", "m", "m²", "m³", "kg", or "L".

DO NOT set sectionMultiplier equal to a material's own quantity — sectionMultiplier is the count of repeating WORK UNITS (bays, footings, square metres of deck), not the count of items.

SANITY-CHECK every quantity before returning. The most common failure is over-spec'ing repeating elements by 3-10×. For ANY job in ANY trade, derive each quantity from a structural anchor — never guess:

- REPEATING LINEAR ELEMENTS (deck joists, fence posts, wall studs, ceiling battens, roof rafters): count = ceil(span / centres) + 1. A 5m-wide deck with joists at 450mm = 12 joists, NOT 60. A 30m fence at 2.4m bays = 13 posts, NOT 30.
- PER-AREA ELEMENTS (decking clips, tiles, plasterboard sheets, paving, downlights, GPOs): count = area × density. A 400x400 paver covers 0.16m² → density = 6.25/m². 25m² needs ~157, +10% waste = 172. NOT 430. 600x600 tiles ~2.78/m². Don't multiply density by 5.
- PIECE-GOODS UNIT IS ALWAYS "each" — pavers, tiles, decking boards, plasterboard sheets, weatherboard, downlights, GPOs, hinges. NEVER emit unit "m²" or "m³" for a discrete piece-good. If you find yourself writing "83 m³ of concrete pavers" you got the unit wrong — convert to a count using area ÷ piece-coverage.
- LINEAR MATERIAL FROM AREA (decking boards, weatherboard, cladding): linear metres = area / board_width. 50m² of 137mm decking = ~365 lm, NOT 1000+.
- ONE-PER-UNIT ITEMS (hinges per door, taps per basin, downpipes per roof side, post stirrups per post): count = N units × items_per_unit (usually 1-3).
- FASTENERS / CONSUMABLES: tie to a structural anchor too — nails per joist hanger × hangers, screws per metre of trim × metres, sealer at coverage rate × area. Never invent thousands.
- BULK AGGREGATES (sand, crusher dust, gravel, road base): emit TOTAL MASS in kg, not bag counts. Mass = area × depth × density. Typical densities: sand ~1700 kg/m³, crusher dust / road base ~1600 kg/m³, gravel ~1500 kg/m³. The pricing layer handles bag math — see the CRITICAL rule above.
- POURED CONCRETE / READY-MIX sold loose by volume: emit m³. A 0.054 m³ footing = 0.054, unit "m³". For a slab: m³ = area × thickness.

Round up by 10-15% for waste, not by 5-10×. After listing each material ask yourself: "Did I derive this from a structural anchor or did I guess?" If guessed, redo it. Write the derivation math into the "reasoning" field for every per-area, per-volume, or repeating-unit quantity — no math = the row will be flagged.

WORKED EXAMPLE — 25m² (5m × 5m) paver patio, a previously-broken case the system used to inflate to $80k. Correct outputs:
- Concrete pavers 400x400mm: 25 ÷ 0.16 = 157, ×1.1 waste = 172. quantity 172, unit "each". reasoning: "25m² ÷ 0.16m² per paver × 1.1 waste = 172".
- Crusher dust base @ 100mm: 25 × 0.1 × 1600 = 4000. quantity 4000, unit "kg". reasoning: "25m² × 0.1m × 1600kg/m³ = 4000kg".
- Bedding sand @ 30mm: 25 × 0.03 × 1700 = 1275. quantity 1275, unit "kg".
- Jointing sand for 400x400 pavers: ~1 kg/m² → 25 kg. quantity 25, unit "kg".
- Geotextile / weed mat: 25 × 1.2 = 30. quantity 30, unit "m²". reasoning: "25m² + 20% overlap = 30m²".
- Plate compactor hire (half day): quantity 1, unit "each".
WRONG outputs to avoid: "1575 each" of crusher dust, "1050 each" of bedding sand, "100 each" of jointing sand, "430 each" of pavers — these label bulk quantities as "each" and inflate cost ~20×.

WORKED EXAMPLE — 30 m² (15m × 2m) merbau deck, no handrails — a previously-broken case that inflated to ~$75k off a single decking line. Correct outputs:
- Merbau decking board 90x19mm: lineal metres = 30 ÷ 0.094 (90mm board + 4mm gap) = 319 lm; boards = 319 ÷ 5.4m board length × 1.1 waste ≈ 65. quantity 65, unit "each". reasoning: "30m² ÷ 0.094m coverage = 319 lm ÷ 5.4m × 1.1 = 65". WRONG: 891 (that labels lineal-metre or per-m² maths as a board count).
- Treated pine joists 90x45 @ 450 centres: (2 ÷ 0.45) + 1 = 6 joists × 15m = 90. quantity 90, unit "m".
- H4 posts 90x90 @ 1.8m: ((15 ÷ 1.8) + 1) ≈ 10 per row × 2 rows ≈ 20. quantity 20, unit "each". WRONG: 70.
- Decking oil: 30m² × 2 coats ÷ ~8 m²/L = ~8. quantity 8, unit "L". WRONG: "12 tins".
This deck is ONE discrete unit (sectionMultiplier = 1), NOT a per-m² surface-covering section — do not multiply these per-deck counts by the area.

WORKED EXAMPLE — 165 m² single-storey tile-to-Colorbond re-roof (tiles off, corrugated .48 on) — a previously-broken case that classed a roof as per-m² and laundered "165" onto every line (165 sheets, 165 silicone tubes, 495 screws). This is ONE discrete roof (sectionMultiplier = 1); labour lives in a per-m² labour section if you like, but MATERIALS are derived from area + lengths, NEVER × area:
- Colorbond corrugated .48 sheets: cover width ≈ 0.762m → lineal metres = 165 ÷ 0.762 × 1.1 waste ≈ 238. quantity 238, unit "m". reasoning: "165m² ÷ 0.762m cover × 1.1 = 238 lm". WRONG: 165 (that is the raw area, not lineal metres).
- Anticon roofing blanket: 165 ÷ ~18 m² per roll × 1.1 ≈ 10. quantity 10, unit "each". WRONG: 165.
- Roof battens @ 900 centres: (roof-slope-run ÷ 0.9 + 1) × ridge-length ≈ derive lineal metres (~185 lm typical). quantity ~185, unit "m". WRONG: 165 or 28-off-nothing.
- Ridge capping: ridge-line length only (a single-storey gable ≈ 8–14 lineal m), unit "m". WRONG: 55 lengths / 165.
- Roofing screws: ~5–6 per m² tie-down → 165 × 6 ≈ 990. quantity 990, unit "each". WRONG: 495 (that is 165 × 3 laundered).
- Roof & gutter silicone: a few tubes per job — 6. quantity 6, unit "each". WRONG: 165 tubes.
If EVERY roofing material comes out at 165 (or a small multiple), you have laundered the area — STOP and derive each from coverage and lengths.

Guidelines:
- Group materials into REPEATING WORK UNITS where possible. Identify the smallest repeating unit for each section (e.g. one fence bay, one square metre of decking, one staircase riser).
- For each section, specify materials with PER-UNIT quantities and a "sectionMultiplier" for how many units the job needs. Example: a 20m fence with 2.4m bays → each material has per-bay quantity, sectionMultiplier = 9.
- Non-repeating items (one-off materials like a single gate latch) should have sectionMultiplier: 1.
- Use descriptive section names that include context from the job (e.g. "Colorbond Fence Bay" not just "Fencing", "Merbau Deck Section" not just "Decking").
- All materials in the same section MUST have the same sectionMultiplier value.
- Use GENERIC product terms suitable for ${storeName}
- Specify material type, size, and specs but avoid brand-specific names
- GOOD examples: "brass stop valve 15mm quarter turn", "treated pine H3 90x45 2.4m", "PTFE thread tape 12mm"
- BAD examples: "Kinetic valve", "Ozito drill", "Ramset anchor" (these are brand-specific)
- Use common material specifications: timber grades (H3/H4), dimensions, thread sizes, capacities
- Include all materials needed: primary materials, fasteners, adhesives, finishes, etc.
- Be realistic with quantities - round up for waste (typically 10-15% extra)
- Include safety/prep materials if relevant (sandpaper, drop sheets, cleaning supplies, etc.)
- Estimate labor hours realistically for an experienced tradie in this specialty
- Consider the suggested materials but don't limit yourself to only those
- Think about what a professional ${tradeContext?.nicheName || 'tradie'} would need for this job

FLOORPLAN ANALYSIS (only when one of the attached files is an architectural plan, floorplan, or scaled drawing — NOT an ordinary site photo; plans may arrive as images OR PDF documents):
- First classify each attached file as a PLAN or a SITE PHOTO. Treat ordinary photos exactly as before; only fill "floorplanAnalysis" when at least one file is a plan/drawing (a PDF of drawings counts). If no plan is attached, OMIT "floorplanAnalysis" entirely.
- This is trade-agnostic: read the geometry, don't assume a trade. The same output serves flooring, tiling, painting, concreting, landscaping, fencing, roofing, etc.
- CALIBRATE FIRST, then measure everything FROM that scale — do not eyeball areas. Establish one real-world scale from the strongest reference ON THE DRAWING ITSELF, in this order, and you MUST record it in "calibration" (source + a short note stating the scale you derived):
  1. a clearly labelled dimension on the drawing (treat a known structural grid spacing as a labelled dimension — if the grid is evenly spaced and any one bay is dimensioned, apply that spacing across the whole drawing, and count grid bays to derive the overall length AND width rather than eyeballing edge positions; use source "known_dimension");
  2. a printed scale bar you can measure against (source "scale_bar"; a bare ratio like "1:100" with nothing to measure it against is NOT usable on its own — fall back to a labelled dimension);
  3. LAST RESORT ONLY — permitted solely when you have searched the drawing and found NO legible labelled dimension, NO dimensioned grid bay, and NO measurable scale bar: a total dimension the tradie stated in the job description (source "stated_total"). Architect/engineer drawings almost always carry at least one labelled dimension or a dimensioned grid — hunt for the small circled/annotated numbers before giving up. Your "note" MUST name the exact reference you measured against (e.g. "grid bay 9–10 labelled 2520mm"); a note that only cites the job text while the drawing has visible dimension labels means you used the wrong source.
- CRITICAL — measurements must be INDEPENDENT of the job text: "footprintDims", "totalAreaM2", every zone "areaM2"/"dims" and "perimeterM" must come from YOUR OWN measurement of the drawing against that drawing-derived scale. NEVER copy a measurement stated in the job text into these fields, never nudge or "proportionally estimate" your numbers toward it, and never use it to derive the width. Reporting "footprintDims" equal to "statedLengthMm" without having measured it off the drawing is a contract violation — it silently disables the app's deterministic reconciliation. If your measurement disagrees with a stated dimension, that is EXPECTED and useful: report YOUR measurement unchanged and note the discrepancy in "assumptions" — the app reconciles stated measurements deterministically afterwards, but only if you report what you actually measured.
- Measure "widthM" exactly the way you measured "lengthM" — off the drawing against your scale reference, never "proportionally" from the length. Cross-check: widthM/lengthM must match the visual aspect ratio of the building outline in the image (a building that looks ~3× longer than it is wide cannot have widthM > lengthM/2).
- If the tradie stated the building/site's overall length in the job description, echo it (in millimetres) as "calibration": { ..., "statedLengthMm": 49000 } IN ADDITION to your own measurements. Omit "statedLengthMm" when nothing was stated.
- Derive every "areaM2", "dims" and "perimeterM" by measuring against that single scale — never by guessing. Compute "totalAreaM2" two independent ways and reconcile them: (a) the overall footprint from its outer dimensions minus any notches/cutouts, and (b) the sum of the zone areas. If they differ by more than ~15%, re-measure, report the reconciled figure, and lower "confidence".
- ALWAYS echo "footprintDims": { "lengthM", "widthM" } — the overall outer bounding-box dimensions you measured for the whole plan (the longer side is "lengthM"). Report exactly what you measured here; do not pre-adjust it.
- "perimeterM" is the outer boundary length (drives skirting/edging/cornice/kerb/fence runs). "zones" are the distinct regions you can identify, each { "label", "code" (a printed room number or area/finish code if shown, else omit), "areaM2", "dims": { "lengthM", "widthM" } }. When the drawing's legend tags regions with a finish/area code, carry that code on every zone so same-finish areas can be totalled.
- Per zone, when the scope involves edge treatment along that zone's boundary (skirting, coving, cornice, tile trim, edging) and the drawing lets you measure it: also include "perimeterM" (that zone's internal boundary length) and "openingsDeductionM" (summed width of doorways/openings in that boundary — edge runs stop at openings). The net run (perimeterM - openingsDeductionM) is what the edge material quantity should be grounded on. Omit both rather than guess.
- If the scope involves removing/stripping existing surfaces, estimate "removalAreaM2" and a rough waste skip volume "removalBinM3".
- ALWAYS include "assumptions" (what you inferred or could not read clearly) and "confidence": "high" ONLY when scale came from a scale bar or labelled dimension AND the two area methods agreed; "medium" when scale came from a stated total or grid spacing; "low" when scale was guessed or the drawing was hard to read. NEVER silently invent dimensions — if you can't establish scale at all, set detected:true, confidence:"low", omit the numbers, and say so in "assumptions".
- Use the calibrated areas/perimeter to GROUND the material quantities above (e.g. m² of surface, lineal m of edge) instead of guessing — and show that derivation in each material's "reasoning".
- For every material whose quantity you derived from the plan geometry, tag it with "planBasis": "area" (scales with floor area), "perimeter" (scales with edge length), or "volume" (scales with area×depth). One-off counts (gates, fixtures, single appliances) get "planBasis": "fixed". This lets the app deterministically re-scale quantities if the takeoff is anchored to a measurement the tradie stated, so the priced quantities never drift from the corrected areas.
- Shape: "floorplanAnalysis": { "detected": true, "scale": "1:100", "calibration": { "source": "scale_bar|known_dimension|stated_total", "basisMm": 2520, "statedLengthMm": 49000, "note": "..." }, "footprintDims": { "lengthM": 0, "widthM": 0 }, "totalAreaM2": 0, "perimeterM": 0, "zones": [ { "label": "...", "code": "...", "areaM2": 0, "perimeterM": 0, "openingsDeductionM": 0, "dims": { "lengthM": 0, "widthM": 0 } } ], "removalAreaM2": 0, "removalBinM3": 0, "assumptions": "...", "confidence": "medium" }

Return ONLY valid JSON, no other text.`;
}
