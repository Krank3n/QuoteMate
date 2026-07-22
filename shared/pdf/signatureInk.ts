/**
 * signatureInk — is a captured signature path real ink?
 *
 * Point-count and "contains an L" checks both fail in practice: a tap with a
 * micro-twitch captures `M 400 57 L 400 57` — a line-to of zero length that
 * passes structural checks and renders as an invisible "signed" mark on the
 * customer PDF. The only robust test is the measured length of the drawn ink.
 *
 * Lives in shared/ so the on-device SignaturePad and both PDF renderers
 * (client expo-print, server Puppeteer) agree on one definition of "signed".
 */

/**
 * Total drawn length of an `M x y L x y …` path, in capture-space units.
 * Malformed input measures 0.
 */
export function pathInkLength(d: string | undefined | null): number {
  if (!d) return 0;
  // Tokenise into commands with coordinate pairs. Only M and L are ever
  // produced by the pad; anything else is ignored.
  const tokens = d.match(/[ML]\s*[-\d.]+\s+[-\d.]+/g);
  if (!tokens) return 0;

  let length = 0;
  let prev: { x: number; y: number } | null = null;
  for (const token of tokens) {
    const cmd = token[0];
    const [x, y] = token
      .slice(1)
      .trim()
      .split(/\s+/)
      .map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (cmd === 'L' && prev) {
      length += Math.hypot(x - prev.x, y - prev.y);
    }
    prev = { x, y };
  }
  return length;
}

/**
 * Minimum drawn length (capture-space px) for a path to count as a
 * signature. Real signatures measure in the hundreds; taps and twitches
 * measure ~0–5.
 */
export const MIN_SIGNATURE_INK_LENGTH = 10;

/** True when the path carries enough measured ink to count as signed. */
export function pathHasInk(
  d: string | undefined | null,
  minLength: number = MIN_SIGNATURE_INK_LENGTH,
): boolean {
  return pathInkLength(d) >= minLength;
}
