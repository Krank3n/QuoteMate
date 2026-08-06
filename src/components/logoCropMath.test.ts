import { describe, expect, it } from 'vitest';
import { fitImage, clampToImage, toSourceCrop, resizeFromCorner } from './logoCropMath';

describe('resizeFromCorner', () => {
  const start = { x: 100, y: 100, w: 200, h: 200 };

  it('bottom-right dragged out grows the box, origin pinned', () => {
    const r = resizeFromCorner(start, 40, 30, 1, 1, 40);
    expect(r).toEqual({ x: 100, y: 100, w: 240, h: 230 });
  });

  it('bottom-right dragged in shrinks the box', () => {
    expect(resizeFromCorner(start, -50, -50, 1, 1, 40).w).toBe(150);
  });

  it('top-left dragged out grows the box and moves the origin', () => {
    const r = resizeFromCorner(start, -40, -30, -1, -1, 40);
    expect(r).toEqual({ x: 60, y: 70, w: 240, h: 230 });
  });

  it('top-left dragged in shrinks from that side only', () => {
    const r = resizeFromCorner(start, 50, 50, -1, -1, 40);
    expect(r.x).toBe(150);
    expect(r.w).toBe(150);
    expect(r.x + r.w).toBe(start.x + start.w); // far edge stayed put
  });

  it('mixed corner: top-right', () => {
    const r = resizeFromCorner(start, 30, -20, 1, -1, 40);
    expect(r.w).toBe(230);
    expect(r.y).toBe(80);
    expect(r.h).toBe(220);
  });

  it('clamps at the minimum without walking the origin past it', () => {
    const r = resizeFromCorner(start, 500, 500, -1, -1, 40);
    expect(r.w).toBe(40);
    expect(r.x).toBe(260); // start.x + start.w - min
    expect(r.x + r.w).toBe(start.x + start.w);
  });
});

describe('fitImage', () => {
  it('letterboxes a wide image in a square frame', () => {
    // 1000x250 wordmark in a 300x300 frame -> full width, bars top and bottom
    const fit = fitImage({ w: 1000, h: 250 }, { w: 300, h: 300 })!;
    expect(fit.scale).toBeCloseTo(0.3);
    expect(fit.w).toBeCloseTo(300);
    expect(fit.h).toBeCloseTo(75);
    expect(fit.x).toBeCloseTo(0);
    expect(fit.y).toBeCloseTo(112.5);
  });

  it('pillarboxes a tall image', () => {
    const fit = fitImage({ w: 250, h: 1000 }, { w: 300, h: 300 })!;
    expect(fit.h).toBeCloseTo(300);
    expect(fit.x).toBeCloseTo(112.5);
  });

  it('returns null for a frame that has not laid out yet', () => {
    expect(fitImage({ w: 100, h: 100 }, { w: 0, h: 0 })).toBeNull();
  });
});

describe('toSourceCrop', () => {
  const natural = { w: 1000, h: 250 };
  const fit = fitImage(natural, { w: 300, h: 300 })!;

  it('maps the whole box back to the whole image', () => {
    const crop = toSourceCrop({ x: fit.x, y: fit.y, w: fit.w, h: fit.h }, fit, natural);
    expect(crop).toEqual({ originX: 0, originY: 0, width: 1000, height: 250 });
  });

  it('maps the right-hand half back to the right-hand half', () => {
    const crop = toSourceCrop(
      { x: fit.x + fit.w / 2, y: fit.y, w: fit.w / 2, h: fit.h },
      fit,
      natural,
    );
    expect(crop.originX).toBe(500);
    expect(crop.width).toBe(500);
  });

  it('accounts for the letterbox offset rather than the raw frame', () => {
    // A box at the very top of the IMAGE is y=112.5 in frame points, not 0.
    // Forgetting fit.y here would crop from above the artwork.
    const crop = toSourceCrop({ x: fit.x, y: fit.y, w: fit.w, h: 10 }, fit, natural);
    expect(crop.originY).toBe(0);
  });

  it('never runs past the edge of the source', () => {
    const crop = toSourceCrop(
      { x: fit.x + fit.w - 5, y: fit.y, w: 999, h: 999 },
      fit,
      natural,
    );
    expect(crop.originX + crop.width).toBeLessThanOrEqual(natural.w);
    expect(crop.originY + crop.height).toBeLessThanOrEqual(natural.h);
  });

  it('always yields at least one pixel', () => {
    const crop = toSourceCrop({ x: fit.x, y: fit.y, w: 0, h: 0 }, fit, natural);
    expect(crop.width).toBeGreaterThan(0);
    expect(crop.height).toBeGreaterThan(0);
  });
});

describe('clampToImage', () => {
  const fit = fitImage({ w: 1000, h: 250 }, { w: 300, h: 300 })!;

  it('pulls a box back inside the image', () => {
    const box = clampToImage({ x: -50, y: 0, w: 100, h: 50 }, fit, 40);
    expect(box.x).toBeGreaterThanOrEqual(fit.x);
    expect(box.y).toBeGreaterThanOrEqual(fit.y);
  });

  it('enforces the minimum size', () => {
    expect(clampToImage({ x: fit.x, y: fit.y, w: 5, h: 5 }, fit, 40).w).toBe(40);
  });

  it('never lets the box exceed the image', () => {
    const box = clampToImage({ x: fit.x, y: fit.y, w: 9999, h: 9999 }, fit, 40);
    expect(box.w).toBeLessThanOrEqual(fit.w);
    expect(box.h).toBeLessThanOrEqual(fit.h);
  });
});
