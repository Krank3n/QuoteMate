/**
 * Logo surface analysis — what a logo is sitting on, and what we may safely
 * do about it.
 *
 * A survey of the 88 logos on real accounts found that 93% carry a visible
 * background box on the invoice:
 *
 *   white plate      38%   faint box on tinted paper
 *   DARK plate       31%   black box around the logo on cream paper
 *   photo / busy     17%   someone photographed their van or signage
 *   mid-tone plate    8%
 *   transparent       7%   the only case that renders cleanly today
 *
 * The obvious fix — "strip the background" — is destructive for a third of
 * them. A dark plate is usually load-bearing: ASCEND, bunya, AKF and friends
 * are light artwork ON dark, so removing the dark leaves white-on-cream, i.e.
 * an invisible logo. Inverting is worse still, because it rewrites brand
 * colours (a red logo comes back cyan).
 *
 * So the rule here is not "is there a background" but "is the artwork darker
 * than its background". Only then is the background safe to drop: dark ink
 * survives on light paper. Everything else keeps its plate, and the PDF is
 * told to render that plate deliberately instead of as a raw rectangle.
 */

export type LogoBackground = 'transparent' | 'light' | 'dark' | 'busy';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface LogoSurface {
  /** What the border of the image looks like. */
  background: LogoBackground;
  /** The uniform background colour, when there is one. */
  backgroundColor?: Rgb;
  /** Median luminance of the artwork (0-255), ignoring background pixels. */
  artworkLuminance: number;
  /**
   * True only when dropping the background provably cannot hide the artwork —
   * i.e. the artwork is meaningfully darker than the background it sits on.
   */
  canStripBackground: boolean;
}

/** Rec. 709 luma. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Alpha at or above this counts as opaque. */
const OPAQUE_ALPHA = 32;
/** Spread across the border ring above which we call it a photo, not a plate. */
const BUSY_SPREAD = 90;
/** Border must be at least this uniform-transparent to count as transparent. */
const TRANSPARENT_SHARE = 0.9;
/** How much darker the artwork must be than the background to strip safely. */
const STRIP_LUMA_MARGIN = 60;
/** Per-channel tolerance when matching a pixel to the background colour. */
export const BACKGROUND_TOLERANCE = 26;
/** Loosened tolerance used only to probe how flat the background really is. */
export const LOOSE_TOLERANCE = 70;
/**
 * Halo risk above which the cut is judged too ragged to use, leaving the plate
 * in place instead. Calibrated against the 88 real logos — see haloRisk.
 */
export const MAX_HALO_RISK = 0.15;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/**
 * Inspect the border ring (not just the corners — artwork often touches one
 * edge) plus the interior, and decide what the logo is sitting on.
 */
export function analyzeLogoSurface(width: number, height: number, rgba: Uint8Array): LogoSurface {
  const at = (x: number, y: number) => (y * width + x) * 4;

  const ring: number[] = [];
  for (let x = 0; x < width; x++) {
    ring.push(at(x, 0), at(x, height - 1));
  }
  for (let y = 0; y < height; y++) {
    ring.push(at(0, y), at(width - 1, y));
  }

  let transparentRing = 0;
  const ringLums: number[] = [];
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let opaqueRing = 0;
  for (const i of ring) {
    if (rgba[i + 3] < OPAQUE_ALPHA) {
      transparentRing++;
      continue;
    }
    opaqueRing++;
    sumR += rgba[i];
    sumG += rgba[i + 1];
    sumB += rgba[i + 2];
    ringLums.push(luminance(rgba[i], rgba[i + 1], rgba[i + 2]));
  }

  if (transparentRing / ring.length >= TRANSPARENT_SHARE || opaqueRing === 0) {
    return {
      background: 'transparent',
      artworkLuminance: artworkLuma(width, height, rgba, undefined),
      canStripBackground: false, // already clean — nothing to strip
    };
  }

  ringLums.sort((a, b) => a - b);
  const bgLuma = percentile(ringLums, 0.5);
  const spread = percentile(ringLums, 0.9) - percentile(ringLums, 0.1);
  const backgroundColor: Rgb = {
    r: Math.round(sumR / opaqueRing),
    g: Math.round(sumG / opaqueRing),
    b: Math.round(sumB / opaqueRing),
  };

  if (spread > BUSY_SPREAD) {
    return {
      background: 'busy',
      artworkLuminance: artworkLuma(width, height, rgba, undefined),
      canStripBackground: false, // a photo has no single background to drop
    };
  }

  const inkLuma = artworkLuma(width, height, rgba, backgroundColor);
  const background: LogoBackground = bgLuma >= 128 ? 'light' : 'dark';

  return {
    background,
    backgroundColor,
    artworkLuminance: inkLuma,
    // Safe only when the artwork is clearly darker than what it sits on.
    // Light-on-dark logos keep their plate — without it they vanish on paper.
    canStripBackground: bgLuma - inkLuma >= STRIP_LUMA_MARGIN,
  };
}

/** Median luminance of pixels that are not the background. */
function artworkLuma(
  width: number,
  height: number,
  rgba: Uint8Array,
  background: Rgb | undefined,
): number {
  const lums: number[] = [];
  for (let i = 0; i < width * height * 4; i += 4) {
    if (rgba[i + 3] < OPAQUE_ALPHA) continue;
    if (background && matchesBackground(rgba, i, background)) continue;
    lums.push(luminance(rgba[i], rgba[i + 1], rgba[i + 2]));
  }
  if (lums.length === 0) return 0;
  lums.sort((a, b) => a - b);
  return percentile(lums, 0.5);
}

function matchesBackground(
  rgba: Uint8Array,
  i: number,
  bg: Rgb,
  tolerance: number = BACKGROUND_TOLERANCE,
): boolean {
  return (
    Math.abs(rgba[i] - bg.r) <= tolerance &&
    Math.abs(rgba[i + 1] - bg.g) <= tolerance &&
    Math.abs(rgba[i + 2] - bg.b) <= tolerance
  );
}

/**
 * Make the background transparent, flood-filling inward from the border.
 *
 * Deliberately connectivity-based rather than a global colour match: a global
 * match would also punch out same-coloured pixels *inside* the artwork — the
 * white of an eye, the gap in a letter O — leaving the logo full of holes.
 * Only background reachable from the edge is removed.
 *
 * Returns a new buffer; the input is left alone. No-ops (returns null) when
 * the surface says stripping is unsafe, so callers can't misuse it.
 */
export function removeUniformBackground(
  width: number,
  height: number,
  rgba: Uint8Array,
  surface: LogoSurface,
): Uint8Array | null {
  if (!surface.canStripBackground) return null;
  return stripBackground(width, height, rgba, surface);
}

/**
 * Strip the background whether or not we would recommend it.
 *
 * canStripBackground answers "should this be the default", which is not the
 * same question as "may the tradie have it at all". Nothing here is
 * destructive — the original is kept alongside — so refusing to even produce
 * the variant just hides a legitimate option behind our guess. A light-on-dark
 * logo previews as almost nothing on paper, which explains the recommendation
 * far better than a greyed-out control does.
 *
 * Still refuses a torn cut: a ragged halo is nobody's intent, so the halo guard
 * applies regardless. Transparent needs no strip, and a photo has no single
 * background to take.
 */
export function stripBackground(
  width: number,
  height: number,
  rgba: Uint8Array,
  surface: LogoSurface,
): Uint8Array | null {
  if (!surface.backgroundColor) return null;
  if (surface.background === 'transparent' || surface.background === 'busy') return null;
  const out = floodClearBackground(width, height, rgba, surface.backgroundColor);
  return haloRisk(width, height, rgba, surface.backgroundColor) > MAX_HALO_RISK ? null : out;
}

/**
 * How much background the tight cut is leaving behind.
 *
 * A clean plate — a flat white export — is cleared almost entirely by the
 * tight tolerance, and loosening it finds little more. A textured or
 * JPEG-noisy plate stops the tight fill early, leaving a halo hugging the
 * artwork: the "badly cut-out sticker" look, which reads worse than the plate
 * we set out to remove. Loosening the tolerance then clears a great deal more,
 * and that gap is the signal.
 *
 * Measured as the extra area a much looser fill would reach, relative to what
 * the tight fill already cleared. Near 0 means the plate really is flat.
 *
 * (The obvious metric — counting leftover background-coloured pixels next to
 * cleared space — reads 0.00 on every real logo including the bad ones, because
 * a halo is precisely the pixels whose colour the tight tolerance did NOT
 * match. It measures the wrong thing.)
 */
export function haloRisk(width: number, height: number, rgba: Uint8Array, bg: Rgb): number {
  const tight = countCleared(floodClearBackground(width, height, rgba, bg, BACKGROUND_TOLERANCE));
  const loose = countCleared(floodClearBackground(width, height, rgba, bg, LOOSE_TOLERANCE));
  if (tight === 0) return Infinity;
  return (loose - tight) / tight;
}

function countCleared(stripped: Uint8Array): number {
  let n = 0;
  for (let i = 3; i < stripped.length; i += 4) {
    if (stripped[i] < OPAQUE_ALPHA) n++;
  }
  return n;
}

/**
 * The flood fill on its own, without the raggedness guard. Exported so the
 * threshold can be calibrated against real logos; callers should prefer
 * removeUniformBackground, which refuses a cut that would look torn.
 */
export function floodClearBackground(
  width: number,
  height: number,
  rgba: Uint8Array,
  bg: Rgb,
  tolerance: number = BACKGROUND_TOLERANCE,
): Uint8Array {
  const out = rgba.slice();
  const seen = new Uint8Array(width * height);
  // Plain array as a stack — RN's Hermes has no fast queue, and DFS order is
  // irrelevant here.
  const stack: number[] = [];

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p]) return;
    seen[p] = 1;
    const i = p * 4;
    if (rgba[i + 3] < OPAQUE_ALPHA) {
      // already transparent — keep walking through it
      stack.push(x, y);
      return;
    }
    if (!matchesBackground(rgba, i, bg, tolerance)) return;
    out[i + 3] = 0;
    stack.push(x, y);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  return out;
}

