/**
 * signaturePath
 *
 * Pure helper that turns captured pointer strokes into an SVG path `d` string.
 * Each stroke starts with an `M` (move-to) command for its first point and
 * emits an `L` (line-to) command for every subsequent point. Multiple strokes
 * are concatenated, so a lifted pen produces a fresh `M` (a break in the ink).
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
 * Empty input (or strokes that contain no points) yields an empty string.
 */
export function buildSvgPath(strokes: Point[][]): string {
  if (!strokes || strokes.length === 0) return '';

  const segments: string[] = [];

  for (const stroke of strokes) {
    if (!stroke || stroke.length === 0) continue;

    const [first, ...rest] = stroke;
    let segment = `M ${first.x} ${first.y}`;
    for (const point of rest) {
      segment += ` L ${point.x} ${point.y}`;
    }
    segments.push(segment);
  }

  return segments.join(' ');
}
