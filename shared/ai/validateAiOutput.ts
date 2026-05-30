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
  invalidUnitCount: number;
  zeroLabourSections: string[];
  zeroPricedMaterialCount: number;
  absurdQuantityCount: number;
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
  'm³': 100,    // 100 m³ of concrete — a slab or footings job
  m3: 100,
  L: 500,       // 500 L of paint/oil — a commercial job
};

export function validateAndRepairAiOutput(
  materials: AiMaterial[],
  log: { warn: (msg: string, meta?: unknown) => void } = console,
): { materials: AiMaterial[]; flags: AiValidationFlags } {
  let invalidUnitCount = 0;
  let zeroPricedMaterialCount = 0;
  let absurdQuantityCount = 0;
  // Lowest sectionLaborHours seen per section name — flagged when zero/missing.
  const sectionHours = new Map<string, number>();

  const repaired = materials.map((m) => {
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
    if (Number.isFinite(price) && Number.isFinite(qty) && price === 0 && qty > 0) {
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
      next = { ...next, pricingSource: 'absurd_quantity' };
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

  return {
    materials: repaired,
    flags: {
      hasInvalidUnit: invalidUnitCount > 0,
      hasZeroLabourSection: zeroLabourSections.length > 0,
      hasZeroPricedMaterial: zeroPricedMaterialCount > 0,
      hasAbsurdQuantity: absurdQuantityCount > 0,
      invalidUnitCount,
      zeroLabourSections,
      zeroPricedMaterialCount,
      absurdQuantityCount,
    },
  };
}
