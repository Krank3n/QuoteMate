/**
 * Crop geometry, kept pure so it can be tested without a renderer.
 *
 * The crop box is dragged in on-screen points over a letterboxed image, but
 * expo-image-manipulator wants source pixels. Getting the conversion wrong is
 * quiet and nasty: the crop still succeeds, it just takes the wrong region.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FittedImage {
  /** Where the letterboxed image starts inside its frame, in points. */
  x: number;
  y: number;
  /** Its on-screen size, in points. */
  w: number;
  h: number;
  /** points -> source pixels is `/ scale`. */
  scale: number;
}

/** Where a `contain`-fitted image sits inside a frame. */
export function fitImage(
  natural: { w: number; h: number },
  frame: { w: number; h: number },
): FittedImage | null {
  if (!natural.w || !natural.h || !frame.w || !frame.h) return null;
  const scale = Math.min(frame.w / natural.w, frame.h / natural.h);
  const w = natural.w * scale;
  const h = natural.h * scale;
  return { x: (frame.w - w) / 2, y: (frame.h - h) / 2, w, h, scale };
}

/** Keep a crop box inside the image and no smaller than `min` points. */
export function clampToImage(box: Rect, fit: FittedImage, min: number): Rect {
  const w = Math.min(Math.max(box.w, min), fit.w);
  const h = Math.min(Math.max(box.h, min), fit.h);
  return {
    w,
    h,
    x: Math.min(Math.max(box.x, fit.x), fit.x + fit.w - w),
    y: Math.min(Math.max(box.y, fit.y), fit.y + fit.h - h),
  };
}

/**
 * Resize from a corner handle.
 *
 * `sx`/`sy` say which side the handle is on: -1 = left/top, 1 = right/bottom.
 * A right-hand handle dragged right grows the box; a left-hand handle dragged
 * right shrinks it AND moves the origin, because the opposite edge is pinned.
 * So the size delta is `d * s`, not `d * -s` — inverting it makes every corner
 * resize backwards, which pins the box at its minimum and reads as "dragging
 * doesn't work".
 */
export function resizeFromCorner(
  start: Rect,
  dx: number,
  dy: number,
  sx: -1 | 1,
  sy: -1 | 1,
  min: number,
): Rect {
  const next: Rect = {
    x: sx < 0 ? start.x + dx : start.x,
    y: sy < 0 ? start.y + dy : start.y,
    w: start.w + dx * sx,
    h: start.h + dy * sy,
  };
  // Hitting the floor must not let a left/top handle keep walking the origin.
  if (next.w < min) {
    next.w = min;
    if (sx < 0) next.x = start.x + start.w - min;
  }
  if (next.h < min) {
    next.h = min;
    if (sy < 0) next.y = start.y + start.h - min;
  }
  return next;
}

export interface SourceCrop {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * Convert an on-screen crop box into source-pixel coordinates, clamped so the
 * region can never run past the edge of the image.
 */
export function toSourceCrop(
  box: Rect,
  fit: FittedImage,
  natural: { w: number; h: number },
): SourceCrop {
  const originX = Math.max(0, Math.min(Math.round((box.x - fit.x) / fit.scale), natural.w - 1));
  const originY = Math.max(0, Math.min(Math.round((box.y - fit.y) / fit.scale), natural.h - 1));
  return {
    originX,
    originY,
    width: Math.max(1, Math.min(Math.round(box.w / fit.scale), natural.w - originX)),
    height: Math.max(1, Math.min(Math.round(box.h / fit.scale), natural.h - originY)),
  };
}
