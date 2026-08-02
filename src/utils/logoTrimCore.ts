/**
 * Pure pixel-level whitespace-margin detection for logo trimming.
 * Kept free of RN/expo imports so it unit-tests without mocks; the RN glue
 * (probe render + crop) lives in logoTrim.ts.
 */

export interface ContentBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimum margin (fraction of image edge) required to bother trimming. */
const MIN_MARGIN_FRACTION = 0.02;

/**
 * Find the bounding box of non-near-white pixels in an RGBA buffer.
 * Fully-transparent pixels count as background (they composite onto white in
 * the PDF). Returns null when there is no meaningful uniform margin to trim
 * (full-bleed artwork) or the image is blank.
 *
 * Kept pure and RN-free so the unit tests can run without mocks.
 */
export function computeContentBBox(
  width: number,
  height: number,
  rgba: Uint8Array,
  options?: { threshold?: number },
): ContentBBox | null {
  // Distance below pure white that still counts as "background". JPEG noise
  // around white sits within ~10; 24 tolerates off-white paper photos too.
  const threshold = options?.threshold ?? 24;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3];
      if (a < 16) continue; // transparent → background
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      if (255 - r <= threshold && 255 - g <= threshold && 255 - b <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null; // blank image — nothing to trim to

  const hasMargin =
    minX / width >= MIN_MARGIN_FRACTION ||
    minY / height >= MIN_MARGIN_FRACTION ||
    (width - 1 - maxX) / width >= MIN_MARGIN_FRACTION ||
    (height - 1 - maxY) / height >= MIN_MARGIN_FRACTION;
  if (!hasMargin) return null;

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

