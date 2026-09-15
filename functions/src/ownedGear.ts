/**
 * Owned-gear filter — the deterministic safety net behind the prompt rule
 * "tools, equipment and PPE the tradie already owns are never materials".
 *
 * The generator kept pricing the tradie's toolbox onto the customer's quote
 * (a club hammer and a pry bar on a 5 m² path, a mop, bucket, broom and
 * telescopic pole on a vacate clean the tradie said they bring their own
 * gear for). The prompt now forbids it, but instructions alone are not a
 * control (see detectLaunderedSections), so this drops rows whose NAME
 * clearly names owned gear.
 *
 * Deliberately conservative — a false drop of a real material is worse than
 * a missed tool:
 *   - only whole-word matches on a short list of unmistakable tools/PPE;
 *   - a row is kept when its name also names a consumable accessory (drill
 *     BITS, saw BLADES, disposable gloves, a mop HEAD refill);
 *   - a row is kept when the job description itself mentions that item — a
 *     tradie who wrote "hire a pressure washer" meant it;
 *   - rows the tradie's own data produced (a saved supplier rate, a Reece
 *     SKU) and lump-sum work lines are never touched.
 */

interface OwnedGearPattern {
  /** Short label for logs. */
  label: string;
  /** Matches a material NAME that is this piece of gear. */
  name: RegExp;
  /**
   * Matches a JOB DESCRIPTION that asks for this gear. Defaults to `name`;
   * widened where the tradie would describe the task rather than the tool.
   */
  mention?: RegExp;
}

const OWNED_GEAR: OwnedGearPattern[] = [
  { label: 'hammer', name: /\b(hammers?|mallets?)\b/i },
  { label: 'pry bar', name: /\b(pry|wrecking|demolition|jemmy|crow)\s*bars?\b|\bcrowbars?\b/i },
  // "broom finish" on a concrete job describes the texture, not a request for a broom.
  { label: 'broom', name: /\bbrooms?\b/i, mention: /\bbrooms?\b(?!\s*finish)/i },
  { label: 'dustpan', name: /\bdust\s*pans?\b/i },
  { label: 'mop', name: /\bmops?\b/i },
  { label: 'mop bucket', name: /\b(mop|wringer)\s*buckets?\b/i },
  { label: 'extension pole', name: /\b(extension|telescopic|telescoping|extendable)\s*poles?\b/i },
  { label: 'squeegee', name: /\bsqueegees?\b/i },
  {
    label: 'pressure washer',
    name: /\bgernis?\b|\b(high\s*)?pressure\s*(washers?|cleaners?)\b/i,
    mention: /\bgernis?\b|\b(high\s*)?pressure\s*(wash|clean)/i,
  },
  { label: 'safety glasses', name: /\bsafety\s*(glasses|specs|goggles)\b|\bgoggles\b/i },
  { label: 'gloves', name: /\bgloves?\b/i },
  { label: 'ladder', name: /\bladders?\b/i },
  { label: 'drill', name: /\bdrills?\b/i },
  { label: 'wheelbarrow', name: /\bwheel\s*barrows?\b/i },
  { label: 'shovel', name: /\b(shovels?|spades?)\b/i },
];

/**
 * A name that also names something used up on the job is a consumable, not
 * the tool: "hammer drill bits", "circular saw blade", "disposable nitrile
 * gloves", "mop head refill", "hammer-in fixings 8x80".
 */
const CONSUMABLE_ACCESSORY_RE =
  /\b(bits?|blades?|discs?|refills?|replacements?|cartridges?|heads?|fixings?|anchors?|nails?|screws?|plugs?|sandpaper|disposable|nitrile|latex)\b/i;

export interface OwnedGearResult<T> {
  materials: T[];
  /** Names of the rows that were dropped, in their original order. */
  dropped: string[];
}

/** True when this row came from the tradie's own data or is a scope line. */
function isProtectedRow(m: any): boolean {
  if (!m || typeof m !== 'object') return true;
  if (m.kind === 'work') return true;
  if (m.pricingSource === 'saved_rate') return true;
  if (typeof m.savedRateName === 'string' && m.savedRateName.trim()) return true;
  const reeceId = Number(m.reeceProductId);
  if (Number.isFinite(reeceId) && reeceId > 0) return true;
  return false;
}

/** The owned-gear pattern a material name matches, or null when it is a real material. */
export function matchOwnedGear(name: unknown, jobDescription: string): string | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  if (CONSUMABLE_ACCESSORY_RE.test(name)) return null;
  const description = typeof jobDescription === 'string' ? jobDescription : '';
  for (const gear of OWNED_GEAR) {
    if (!gear.name.test(name)) continue;
    const mention = gear.mention ?? gear.name;
    if (mention.test(description)) return null;
    return gear.label;
  }
  return null;
}

/**
 * Drop generated rows that name gear the tradie owns, unless the job
 * description asked for that item. Pure; returns the same array when nothing
 * is dropped.
 */
export function dropOwnedGear<T extends { name?: unknown }>(
  materials: T[],
  jobDescription: string,
): OwnedGearResult<T> {
  const dropped: string[] = [];
  const kept: T[] = [];
  for (const m of materials || []) {
    if (!isProtectedRow(m) && matchOwnedGear(m?.name, jobDescription)) {
      dropped.push(String(m.name));
      continue;
    }
    kept.push(m);
  }
  return { materials: dropped.length === 0 ? materials : kept, dropped };
}
