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

/**
 * True when a path `d` string contains actual ink — at least one line-to.
 * Used by renderers as defence in depth: a legacy or hand-crafted path of
 * bare move-to commands must not produce a "signed" block.
 */
export function pathHasInk(d: string | undefined | null): boolean {
  return !!d && d.includes('L');
}
