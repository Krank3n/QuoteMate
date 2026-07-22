/**
 * signaturePath
 *
 * Pure helper that turns captured pointer strokes into an SVG path `d` string.
 * Each stroke starts with an `M` (move-to) command for its first point and
 * emits an `L` (line-to) command for every subsequent point. Multiple strokes
 * are concatenated, so a lifted pen produces a fresh `M` (a break in the ink).
 *
 * Single-point strokes are DROPPED: an accidental tap on the pad produces
 * `M x y` with no line — invisible ink that still counts as "signed" and
 * renders an empty signature block on the customer PDF. Real signatures
 * always move the pen, so a stroke needs at least two points to count.
 *
 * Kept dependency-free and side-effect-free so it can be unit tested in
 * isolation and reused by both the on-device SignaturePad and any renderer.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Build an SVG path `d` string from captured strokes.
 * Empty input, strokes with no points, and single-point strokes (accidental
 * taps) yield no ink; all-degenerate input yields an empty string.
 */
export function buildSvgPath(strokes: Point[][]): string {
  if (!strokes || strokes.length === 0) return '';

  const segments: string[] = [];

  for (const stroke of strokes) {
    // A tap is not a signature — require actual pen movement.
    if (!stroke || stroke.length < 2) continue;

    const [first, ...rest] = stroke;
    let segment = `M ${first.x} ${first.y}`;
    for (const point of rest) {
      segment += ` L ${point.x} ${point.y}`;
    }
    segments.push(segment);
  }

  return segments.join(' ');
}

// Canonical "is this real ink?" lives in shared/pdf/signatureInk so the pad
// and both PDF renderers (client expo-print, server Puppeteer) agree on one
// definition of "signed". A structural check (path contains an L) is not
// enough — a tap with a micro-twitch captures a zero-length line-to.
export { pathHasInk, pathInkLength, MIN_SIGNATURE_INK_LENGTH } from '../../shared/pdf/signatureInk';
