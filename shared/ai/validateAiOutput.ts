/**
 * Structural validation of the AI's materials output. Catches the most
 * common shape-level mistakes before the response leaves the server, and
 * stamps a `flags` object the admin can render badges from. Pure data
 * inspection — no LLM calls, no IO. Shared between the cloud function
 * (functions/src/index.ts) and any future client-side preview path.
 *
 * Lives in shared/ rather than functions/src/ so it can be unit-tested
 * from the root vitest config without pulling in firebase-functions deps.
 */

export interface AiMaterial {
  name?: string;
  unit?: string;
  quantity?: number;
  price?: number;
  section?: string;
  sectionLaborHours?: number;
  pricingSource?: string;
  [k: string]: unknown;
}

export interface AiValidationFlags {
  hasInvalidUnit: boolean;
  hasZeroLabourSection: boolean;
  hasZeroPricedMaterial: boolean;
  hasAbsurdQuantity: boolean;
  hasLaunderedSection: boolean;
  /** A name or searchTerm carried a word in a non-Latin script; the word was stripped. */
  hasNonLatinText: boolean;
  invalidUnitCount: number;
  zeroLabourSections: string[];
  zeroPricedMaterialCount: number;
  absurdQuantityCount: number;
  launderedSections: string[];
  nonLatinTokenCount: number;
}

// A whole word in another script. The generator has emitted Cyrillic
// mid-name twice in 743 stored documents — "Consumer mains cable 16mm² двух
// core and earth" reached a customer on an invoice, and "Builders String Line
// ролик 100m" sat on a draft. A word is stripped only when it carries a
// letter of another script and NO Latin letter or digit: "двух" goes,
// "88-108µF", "5μF", "8Ω" and every real product name with ², °, é, Ø, ™
// stay (units and ratings are Greek letters sitting inside Latin words).
//
// Written as \p{L} minus explicit Latin ranges rather than \p{Script=Latin}:
// this file runs on the phone under Hermes as well as on the server, and
// \p{L} with the u flag is the one Unicode property escape this codebase
// already ships there (elevenLabsAgentConfig.ts). µ, μ and Ω are allowed
// outright — they are units, not another language.
const LATIN_LETTER = 'A-Za-z\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u03A9\u03BC\u1E00-\u1EFF\u2126\u2C60-\u2C7F\uA720-\uA7FF\uFB00-\uFB06';
const NON_LATIN_LETTER_RE = new RegExp(`(?![${LATIN_LETTER}])\\p{L}`, 'u');
const LATIN_OR_DIGIT_RE = new RegExp(`[0-9${LATIN_LETTER}]`);

/**
 * The text with any foreign-script word removed. Returns the input untouched
 * when every word is fine, and never empties a name: a name that is ALL
 * foreign words is kept as-is (and still counted) rather than replaced with
 * nothing.
 */
export function stripNonLatinWords(text: string): { text: string; stripped: number } {
  const words = text.split(/(\s+)/);
  let stripped = 0;
  const kept = words.filter((w) => {
    if (!w || /^\s+$/.test(w)) return true;
    if (NON_LATIN_LETTER_RE.test(w) && !LATIN_OR_DIGIT_RE.test(w)) {
      stripped++;
      return false;
    }
    return true;
  });
  if (!stripped) return { text, stripped: 0 };
  const cleaned = kept.join('').replace(/\s{2,}/g, ' ').trim();
  return cleaned ? { text: cleaned, stripped } : { text, stripped };
}

const PIECE_GOOD_NAME_RE = /\b(pavers?|tiles?|decking boards?|plasterboards?|weatherboards?|downlights?|gpos?|hinges?|door handles?)\b/i;
const PIECE_GOOD_BAD_UNITS = new Set(['m²', 'm2', 'm³', 'm3']);

// Deterministic upper bound on per-line quantities, by unit. Anything past
// these is a near-certain over-spec — the kind that produced a $94k fencing
// quote when the AI emitted 6760 bags of concrete for 13 post holes.
// Numbers are intentionally generous: a large reno's worth of fasteners or
// timber metres still fits comfortably. We're catching ORDERS-of-magnitude
// errors, not borderline waste-buffer ones.
const ABSURD_QUANTITY_BY_UNIT: Record<string, number> = {
  pack: 200,    // 200 packs of anything (screws, concrete, mulch) is a huge job
  each: 5000,   // 5000 fasteners covers most jobs comfortably
  kg: 50000,    // 50 tonnes — a concrete-slab job
  m: 2000,      // 2km of timber/cable
  'm²': 1000,   // 1000 m² — a very large surface
  m2: 1000,
  // 30 m³ is already a 300 m² slab at 100 mm. Residential footings need 1-3.
  // Tightened from 100 after QU-178694 shipped 35 m³ on a 6x8 m deck without
  // tripping anything — see clampMaterialQuantity below.
  'm³': 30,
  m3: 30,
  L: 500,       // 500 L of paint/oil — a commercial job
};

/**
 * Thin-layer consumables — products spread over a surface in millimetres.
 * Real-world densities: tile adhesive 3–6 kg/m², grout 0.5–2, render up to
 * ~30 for a thick coat. The $81k bathroom happened because the model emitted
 * a GRAMS-per-m² figure (350) as kg-per-m² and the flat kg ceiling above
 * (calibrated for legitimate bulk — crusher dust, slab concrete at 240+
 * kg/m²) let 350 × 31 m² = 10,850 kg sail through. Density is only absurd
 * relative to what the product IS, so this guard is name-scoped: no
 * thin-layer product spreads at more than ~40 kg per work unit, while
 * concrete and road base legitimately do.
 */
const THIN_LAYER_NAME_RE =
  /\b(adhesive|glue|grout|sealant|silicone|caulk|render|levell?ing compound|primer|additive)\b/i;
const THIN_LAYER_MAX_KG_PER_UNIT = 40;
// Only meaningful when the section multiplier is a real area/spread count —
// a per-unit density against multiplier 1 is just a total, judged above.
const THIN_LAYER_MIN_MULTIPLIER = 10;

/**
 * Units that count discrete objects you buy off a shelf. Half a paver or
 * 0.3 of a screw is meaningless, so these round to whole numbers.
 */
const DISCRETE_UNITS = new Set(['each', 'box', 'pack']);

/**
 * Whole-unit ceiling for discrete counts (fasteners, boards, pavers).
 *
 * This is a PER-UNIT ceiling — it is applied before sectionMultiplier. The
 * ceiling on what actually gets stored is the COUNT_UNITS backstop in
 * convertLLMMaterialsToMaterials, which caps quantity × multiplier at 5000.
 *
 * It used to be 999, which silently truncated whole-job counts in sections
 * with multiplier 1: a 6x8 m deck needs ~26-30 stainless screws per m², so
 * every replay of that job asked for 1300-2400 and got 999 — the tradie
 * buying roughly half the fasteners the deck needs. Raising this to match the
 * post-multiply backstop does NOT widen the worst case, because that backstop
 * is unchanged: a runaway per-unit value still collapses to 5000 once
 * multiplied. It only stops the truncation of counts that were already
 * correct. Anything past 5000 is still badged by ABSURD_QUANTITY_BY_UNIT.
 */
const MAX_DISCRETE_QUANTITY = 5000;
/**
 * Ceiling for continuous measures. Deliberately far above any real job: the
 * per-unit × sectionMultiplier explosion is caught by ABSURD_QUANTITY_BY_UNIT
 * above and by the COUNT_UNITS backstop in convertLLMMaterialsToMaterials.
 * This only stops a garbage value reaching the pricing layer.
 */
const MAX_BULK_QUANTITY = 100000;

/**
 * Clamp an AI-emitted material quantity, respecting whether its unit counts
 * discrete objects or measures a continuous amount.
 *
 * QU-178694: every unit used to share one `Math.min(Math.max(Math.round(q), 1), 999)`.
 * That broke continuous units in both directions:
 *   - `Math.round(0.054)` → 0 → floored to 1. The prompt asks for ready-mix
 *     concrete as m³ PER FOOTING ("A 0.054 m³ footing = 0.054"), so a correct
 *     answer became 1 m³ per footing, then × the 35-footing sectionMultiplier
 *     = 35 m³ of concrete ($9,545) on a 6x8 m deck needing 1.89 m³.
 *   - the 999 ceiling truncated the bulk masses the prompt explicitly asks
 *     for ("4000 kg of crusher dust" for a 25 m² patio) down to 999 kg.
 * Both are the same mistake — a discrete-count clamp applied to a continuous
 * measure. Keep this the ONLY place either rule lives; the client and the
 * server's sanity-check pass both call it.
 */
export function clampMaterialQuantity(quantity: number, unit: string): number {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) return 0;
  if (DISCRETE_UNITS.has(unit)) {
    return Math.min(Math.max(Math.round(q), 1), MAX_DISCRETE_QUANTITY);
  }
  // Continuous measure — keep the fraction. 3 dp matches the precision
  // convertLLMMaterialsToMaterials already stores after × sectionMultiplier.
  const rounded = Math.round(q * 1000) / 1000;
  return Math.min(Math.max(rounded, 0.001), MAX_BULK_QUANTITY);
}

/**
 * A section is "laundered" when its material quantities were never derived:
 * the AI emitted the same round placeholder across several materials against a
 * large sectionMultiplier, so save-time multiplication smears the job's SIZE
 * onto every line.
 *
 * Live example — QU-178425, a 165 m² re-roof stored with multiplier 165 and
 * sheets, batten screws and sealant all at 1 per m²:
 *     165 m of roofing sheet, 165 batten screws, 165 tubes of silicone ($2,887)
 * while the sheets are simultaneously UNDER-quoted (165 lm where 238 is right).
 *
 * The generation prompt already forbids exactly this ("ANTI-LAUNDER RULE") and
 * the model still does it, so instructions alone are not a control. This is the
 * deterministic detector; the server feeds what it finds into the quantity
 * sanity-check pass as a targeted re-derivation order.
 *
 * Calibration is deliberately conservative, checked against stored documents:
 *   - multiplier >= 40 — genuine repeating work-unit counts (fence bays, post
 *     footings, doors) sit well below this, areas in m² sit above it. A 35-footing
 *     deck and a 13-bay fence both stay clear.
 *   - 3+ materials sharing the IDENTICAL small round quantity — a real per-unit
 *     section varies (2 posts, 3 sheets, 1 cap per bay). Three separate lines at
 *     exactly the same 1 is a placeholder, not a calculation.
 *   - fractional quantities are never placeholders, so they are ignored.
 */
const LAUNDER_MIN_MULTIPLIER = 40;
const LAUNDER_MIN_MATCHING_MATERIALS = 3;
const LAUNDER_PLACEHOLDER_MAX = 3;

export function detectLaunderedSections(materials: AiMaterial[]): string[] {
  const bySection = new Map<string, Map<number, number>>();

  for (const m of materials || []) {
    const section = typeof m?.section === 'string' ? m.section.trim() : '';
    if (!section) continue;
    const multiplier = Number((m as any)?.sectionMultiplier);
    if (!Number.isFinite(multiplier) || multiplier < LAUNDER_MIN_MULTIPLIER) continue;
    const qty = Number(m?.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > LAUNDER_PLACEHOLDER_MAX) continue;
    // A fraction means the AI actually did the maths — never a placeholder.
    if (Math.abs(qty - Math.round(qty)) > 1e-9) continue;

    const counts = bySection.get(section) || new Map<number, number>();
    counts.set(qty, (counts.get(qty) || 0) + 1);
    bySection.set(section, counts);
  }

  const laundered: string[] = [];
  for (const [section, counts] of bySection) {
    for (const n of counts.values()) {
      if (n >= LAUNDER_MIN_MATCHING_MATERIALS) {
        laundered.push(section);
        break;
      }
    }
  }
  return laundered;
}

export function validateAndRepairAiOutput(
  materials: AiMaterial[],
  log: { warn: (msg: string, meta?: unknown) => void } = console,
): { materials: AiMaterial[]; flags: AiValidationFlags } {
  let invalidUnitCount = 0;
  let zeroPricedMaterialCount = 0;
  let absurdQuantityCount = 0;
  let nonLatinTokenCount = 0;
  // Lowest sectionLaborHours seen per section name — flagged when zero/missing.
  const sectionHours = new Map<string, number>();

  const repaired = materials.map((raw) => {
    let m = raw;
    // Latin-script guard on the two strings that reach the customer and the
    // supplier search. Stripping the foreign word keeps the line usable;
    // the count is what makes the leak visible.
    for (const field of ['name', 'searchTerm'] as const) {
      const value = m?.[field];
      if (typeof value !== 'string' || !value) continue;
      const cleaned = stripNonLatinWords(value);
      if (cleaned.stripped > 0) {
        nonLatinTokenCount += cleaned.stripped;
        log.warn('[ai-validate] non-Latin text in material', { field, value, cleaned: cleaned.text });
        m = { ...m, [field]: cleaned.text };
      }
    }
    const name = typeof m?.name === 'string' ? m.name : '';
    const unit = typeof m?.unit === 'string' ? m.unit : '';
    let next = m;
    if (name && PIECE_GOOD_NAME_RE.test(name) && PIECE_GOOD_BAD_UNITS.has(unit)) {
      invalidUnitCount++;
      log.warn('[ai-validate] piece-good with area/volume unit', {
        name,
        unit,
        quantity: m.quantity,
      });
      next = { ...m, pricingSource: 'invalid_unit' };
    }
    const price = Number(m?.price);
    const qty = Number(m?.quantity);
    // Work items are lump-sum scope lines, not products — $0 is a valid price
    // for one ("General preparation — included"), so they never count as a
    // zero-priced material.
    const isWorkItem = (m as any)?.kind === 'work';
    if (!isWorkItem && Number.isFinite(price) && Number.isFinite(qty) && price === 0 && qty > 0) {
      zeroPricedMaterialCount++;
    }
    // Absurd-quantity guard. The AI emits `quantity` PER work unit; the
    // client then multiplies by `sectionMultiplier` to get what actually
    // lands in Firestore. A per-unit quantity that looks fine (e.g. 40)
    // can balloon to a clearly-wrong total (40 packs × 10 post holes = 400
    // bags of concrete on a 22m fence — the QU-177971 regression). Apply
    // the ceiling to the EFFECTIVE total, not the per-unit value.
    const ceiling = ABSURD_QUANTITY_BY_UNIT[unit];
    const sectionMul = Number((m as any)?.sectionMultiplier);
    const multiplier = Number.isFinite(sectionMul) && sectionMul > 0 ? sectionMul : 1;
    const effectiveQty = Number.isFinite(qty) ? qty * multiplier : qty;
    if (ceiling !== undefined && Number.isFinite(effectiveQty) && effectiveQty > ceiling) {
      absurdQuantityCount++;
      log.warn('[ai-validate] absurd quantity for unit', {
        name,
        unit,
        perUnitQuantity: qty,
        sectionMultiplier: multiplier,
        effectiveQuantity: effectiveQty,
        ceiling,
      });
      // Don't clobber a more specific diagnosis. A piece-good carried in m³
      // (83 m³ of pavers) is a UNIT error; the absurd volume is a symptom of
      // it, not a second independent fault. Both counts still increment, so
      // no signal is lost — only the single pricingSource label is at stake.
      if (next.pricingSource !== 'invalid_unit') {
        next = { ...next, pricingSource: 'absurd_quantity' };
      }
    }
    // Thin-layer density guard: a per-unit kg figure no adhesive/grout/render
    // could spread at. Catches the grams-emitted-as-kg family the flat kg
    // ceiling can't see (350 "kg"/m² of tile adhesive → 10,850 kg → $49,541
    // on an 11 m² bathroom). Flag-only, like everything here — value
    // rewriting is how QU-178694 happened.
    if (
      unit === 'kg' &&
      multiplier >= THIN_LAYER_MIN_MULTIPLIER &&
      name &&
      THIN_LAYER_NAME_RE.test(name) &&
      Number.isFinite(qty) &&
      qty > THIN_LAYER_MAX_KG_PER_UNIT
    ) {
      absurdQuantityCount++;
      log.warn('[ai-validate] thin-layer density beyond any real product', {
        name,
        perUnitKg: qty,
        sectionMultiplier: multiplier,
        ceiling: THIN_LAYER_MAX_KG_PER_UNIT,
      });
      if (next.pricingSource !== 'invalid_unit') {
        next = { ...next, pricingSource: 'absurd_quantity' };
      }
    }
    const section = typeof m?.section === 'string' ? m.section : null;
    if (section) {
      const hrs = Number(m?.sectionLaborHours);
      const prev = sectionHours.get(section);
      const val = Number.isFinite(hrs) ? hrs : 0;
      if (prev === undefined || val < prev) sectionHours.set(section, val);
    }
    return next;
  });

  const zeroLabourSections: string[] = [];
  for (const [section, hrs] of sectionHours.entries()) {
    if (hrs <= 0) {
      zeroLabourSections.push(section);
      log.warn('[ai-validate] section with zero labour hours', { section });
    }
  }

  const launderedSections = detectLaunderedSections(materials);
  for (const section of launderedSections) {
    log.warn('[ai-validate] section quantities not derived — multiplier will launder', { section });
  }

  return {
    materials: repaired,
    flags: {
      hasInvalidUnit: invalidUnitCount > 0,
      hasZeroLabourSection: zeroLabourSections.length > 0,
      hasZeroPricedMaterial: zeroPricedMaterialCount > 0,
      hasAbsurdQuantity: absurdQuantityCount > 0,
      hasLaunderedSection: launderedSections.length > 0,
      hasNonLatinText: nonLatinTokenCount > 0,
      invalidUnitCount,
      zeroLabourSections,
      zeroPricedMaterialCount,
      absurdQuantityCount,
      launderedSections,
      nonLatinTokenCount,
    },
  };
}
