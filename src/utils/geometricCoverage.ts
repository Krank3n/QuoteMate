/**
 * geometricCoverage — deterministic guard against area-derived piece-good
 * OVER-COUNTS (e.g. 891 decking boards on a 30 m² deck, which should be ~65).
 *
 * Companion to purchaseCoverage.ts. That file clamps bulk fastener / liquid
 * over-BUYS ("19 tubs of screws when one covers the deck"); this one clamps
 * board piece-good over-COUNTS that the model derives wrongly from a job's
 * dimensions. Both ONLY ever clamp DOWN — the caller does
 * `count = min(count, max)` — so a conservative bound can never fabricate a
 * shortfall, and a reasonable count is always left untouched.
 *
 * Real example (quote QU-178020, "15 metre by 2 metre merbau deck" = 30 m²):
 *   - Merbau Decking Board 90x19mm → 891 @ $61.19 = $54,518  (≈ 88% of a $62k
 *     materials bill). ~65 boards is the true number. Nothing caught it: the
 *     generation + reconcile LLM passes both let it through, and the bulk guard
 *     (coverageSanePurchaseCount) deliberately leaves piece-goods alone.
 *
 * Scope is intentionally narrow — board-type piece-goods only (decking,
 * weatherboard, cladding, floorboards), and only when:
 *   1. the job description yields a usable area, and
 *   2. the count is EGREGIOUSLY over a width-derived ceiling (> FIRE_FACTOR×).
 * Pavers/tiles (area ÷ piece-footprint, not width × length) are out of scope
 * here and are handled by the generation prompt's worked example.
 */

export interface GeometricCoverageInput {
  /** Material/product name — classifies board type and supplies the spec. */
  name: string;
  /** The underlying requirement (board count) before this guard. */
  requirement: number;
  /** Job surface area in m², parsed from the description. */
  areaM2: number;
}

// Board-type piece-goods whose count is (area ÷ board-width-coverage) ÷ length.
const BOARD_RE = /\b(?:deck(?:ing)?|weather|cladding|floor)\s*boards?\b/i;

// Decking-style geometry. GAP matches the prompt's stated convention
// ("a 90mm board with a 4mm gap covers 94mm of width").
const GAP_MM = 4;
const WASTE = 1.3; // generous: the ceiling is an upper bound, not an estimate
const DEFAULT_BOARD_LENGTH_M = 5.4; // standard Merbau/treated decking length
// When the width can't be read from the name, assume a NARROW board so the
// ceiling errs HIGH (more lineal metres → more boards → safer, less likely to
// clamp a legitimate count).
const DEFAULT_BOARD_WIDTH_MM = 65;
// Only intervene when the count is clearly inflated. A reasonable count (≤ 2×
// the standard-length ceiling, i.e. covering boards down to ~2.7m) is left
// alone; only blow-ups like 891-for-65 get clamped.
const FIRE_FACTOR = 2;

// Plausible decking board face widths (mm) and lengths (m). Out-of-range parses
// are treated as "unknown" rather than trusted.
const MIN_BOARD_WIDTH_MM = 50;
const MAX_BOARD_WIDTH_MM = 300;
const MIN_BOARD_LENGTH_M = 1.8;
const MAX_BOARD_LENGTH_M = 6.0;

/**
 * Parse a build area from free text: "15 metre by 2 metre", "15m x 2m",
 * "15 x 2m", "15.5m × 2.4m". Requires an explicit metres unit on at least one
 * operand so millimetre specs ("90x19mm") and bare ratios never match. When
 * several dimension pairs appear, the largest-area pair wins (the main surface).
 */
export function parseJobAreaM2(
  text: string | undefined | null,
): { lengthM: number; widthM: number; areaM2: number } | null {
  if (!text) return null;
  // Each optional unit uses a negative lookahead so "mm" (and other letter
  // runs) never read as a metres unit — without it "90x19mm" would parse as a
  // 90×19 = 1710 m² "area". The lookahead lives INSIDE the optional group so a
  // missing unit still allows the letter separators (x / by).
  const re =
    /(\d+(?:\.\d+)?)\s*(?:(metres?|meters?|mtrs?|m)(?![a-z]))?\s*(?:x|×|by|\*)\s*(\d+(?:\.\d+)?)\s*(?:(metres?|meters?|mtrs?|m)(?![a-z]))?/gi;
  let best: { lengthM: number; widthM: number; areaM2: number } | null = null;
  for (const match of text.matchAll(re)) {
    const a = parseFloat(match[1]);
    const unitA = match[2];
    const b = parseFloat(match[3]);
    const unitB = match[4];
    // At least one side must carry a metres unit, else it's not a build dim.
    if (!unitA && !unitB) continue;
    if (!(a > 0) || !(b > 0)) continue;
    // Reject implausible spans (mm specs, typos) — decks/rooms are 0.5–100 m.
    if (a < 0.5 || a > 100 || b < 0.5 || b > 100) continue;
    const lengthM = Math.max(a, b);
    const widthM = Math.min(a, b);
    const areaM2 = lengthM * widthM;
    if (!best || areaM2 > best.areaM2) best = { lengthM, widthM, areaM2 };
  }
  return best;
}

/**
 * Parse the board face width (mm) from a name. Handles "90x19mm" (width ×
 * thickness → 90), "137mm decking", "Spotted Gum 86 x 19". Returns null when
 * no plausible width token is present.
 */
export function parseBoardWidthMm(name: string): number | null {
  if (!name) return null;
  // "90x19mm" / "86 x 19" → first number is the face width.
  const wxt = name.match(/(\d{2,3})\s*[x×]\s*\d{1,3}\s*mm?\b/i);
  if (wxt) {
    const w = parseInt(wxt[1], 10);
    if (w >= MIN_BOARD_WIDTH_MM && w <= MAX_BOARD_WIDTH_MM) return w;
  }
  // Bare "137mm".
  const single = name.match(/(\d{2,3})\s*mm\b/i);
  if (single) {
    const w = parseInt(single[1], 10);
    if (w >= MIN_BOARD_WIDTH_MM && w <= MAX_BOARD_WIDTH_MM) return w;
  }
  return null;
}

/**
 * Parse a board length (m) from a name (e.g. "...5.4m", "5400mm"). Returns null
 * when absent so the caller can fall back to the standard length.
 */
export function parseBoardLengthM(name: string): number | null {
  if (!name) return null;
  // Metres: "5.4m" / "5.4 metre" (but not "5.4mm").
  const m = name.match(/(\d(?:\.\d+)?)\s*m(?:etres?|eters?)?\b(?!m)/i);
  if (m) {
    const len = parseFloat(m[1]);
    if (len >= MIN_BOARD_LENGTH_M && len <= MAX_BOARD_LENGTH_M) return len;
  }
  // Millimetres: "5400mm".
  const mm = name.match(/(\d{4})\s*mm\b/i);
  if (mm) {
    const len = parseInt(mm[1], 10) / 1000;
    if (len >= MIN_BOARD_LENGTH_M && len <= MAX_BOARD_LENGTH_M) return len;
  }
  return null;
}

/**
 * Returns a sane board count (the ceiling) when the row is a clearly inflated
 * area-derived board piece-good, or null to mean "leave the existing count
 * alone". Callers must only ever clamp DOWN: `count = Math.min(count, sane)`.
 */
export function geometricSanePieceCount(input: GeometricCoverageInput): number | null {
  const { name, requirement, areaM2 } = input;
  if (!(requirement > 0) || !(areaM2 > 0)) return null;
  if (!BOARD_RE.test(name)) return null;

  const widthMm = parseBoardWidthMm(name) ?? DEFAULT_BOARD_WIDTH_MM;
  const lengthM = parseBoardLengthM(name) ?? DEFAULT_BOARD_LENGTH_M;
  const effectiveWidthM = (widthMm + GAP_MM) / 1000;

  const linealMetres = areaM2 / effectiveWidthM;
  const ceiling = Math.ceil((linealMetres / lengthM) * WASTE);
  if (!(ceiling > 0)) return null;

  // Only correct egregious over-counts; a plausible count passes through.
  if (requirement <= ceiling * FIRE_FACTOR) return null;
  return ceiling;
}

/**
 * Return the theoretical minimum board count needed to cover the stated area
 * when the priced product exposes BOTH its face width and stock length.
 *
 * Unlike the generous over-count ceiling above, this is safe to use as a floor:
 * fewer boards physically cannot cover the area even with zero cutting waste.
 * We deliberately refuse to guess missing dimensions — defaulting a 137mm
 * composite board to 65mm would manufacture an expensive false shortfall.
 */
export function geometricMinimumPieceCount(input: GeometricCoverageInput): number | null {
  const { name, requirement, areaM2 } = input;
  if (!(requirement > 0) || !(areaM2 > 0)) return null;
  if (!BOARD_RE.test(name)) return null;

  const widthMm = parseBoardWidthMm(name);
  const lengthM = parseBoardLengthM(name);
  if (widthMm === null || lengthM === null) return null;

  const coveragePerBoardM2 = ((widthMm + GAP_MM) / 1000) * lengthM;
  if (!(coveragePerBoardM2 > 0)) return null;

  const minimum = Math.ceil(areaM2 / coveragePerBoardM2);
  return requirement < minimum ? minimum : null;
}
