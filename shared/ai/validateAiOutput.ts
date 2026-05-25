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
  invalidUnitCount: number;
  zeroLabourSections: string[];
  zeroPricedMaterialCount: number;
}

const PIECE_GOOD_NAME_RE = /\b(pavers?|tiles?|decking boards?|plasterboards?|weatherboards?|downlights?|gpos?|hinges?|door handles?)\b/i;
const PIECE_GOOD_BAD_UNITS = new Set(['m²', 'm2', 'm³', 'm3']);

export function validateAndRepairAiOutput(
  materials: AiMaterial[],
  log: { warn: (msg: string, meta?: unknown) => void } = console,
): { materials: AiMaterial[]; flags: AiValidationFlags } {
  let invalidUnitCount = 0;
  let zeroPricedMaterialCount = 0;
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
      invalidUnitCount,
      zeroLabourSections,
      zeroPricedMaterialCount,
    },
  };
}
