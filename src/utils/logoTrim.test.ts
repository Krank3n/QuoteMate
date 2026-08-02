/**
 * The padded-logo support ticket: a wordmark exported onto a big square
 * canvas prints tiny on the PDF because the empty margins scale with the
 * artwork. computeContentBBox is the pure detection half of the fix —
 * these tests pin its contract without any RN mocks.
 */
import { describe, expect, it } from 'vitest';
import { computeContentBBox } from './logoTrimCore';

/** Build an RGBA buffer; `paint` sets non-white pixels. */
function makeImage(
  width: number,
  height: number,
  paint?: (set: (x: number, y: number, r?: number, g?: number, b?: number, a?: number) => void) => void,
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  data.fill(255); // white, opaque
  const set = (x: number, y: number, r = 0, g = 0, b = 0, a = 255) => {
    const i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  };
  paint?.(set);
  return data;
}

describe('computeContentBBox', () => {
  it('returns null for a blank white canvas', () => {
    expect(computeContentBBox(64, 64, makeImage(64, 64))).toBeNull();
  });

  it('finds a centred band with large margins (Ryan’s wordmark case)', () => {
    // 512x512 white canvas, artwork in a horizontal band x:1..374, y:232..298
    const data = makeImage(512, 512, (set) => {
      for (let y = 232; y <= 298; y++) {
        for (let x = 1; x <= 374; x++) set(x, y);
      }
    });
    expect(computeContentBBox(512, 512, data)).toEqual({ x: 1, y: 232, width: 374, height: 67 });
  });

  it('returns null for full-bleed artwork (nothing to trim)', () => {
    const data = makeImage(64, 64, (set) => {
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) set(x, y, 20, 60, 120);
    });
    expect(computeContentBBox(64, 64, data)).toBeNull();
  });

  it('returns null when content already reaches every edge', () => {
    const data = makeImage(64, 64, (set) => {
      for (let x = 0; x < 64; x++) { set(x, 0); set(x, 63); }
      for (let y = 0; y < 64; y++) { set(0, y); set(63, y); }
    });
    expect(computeContentBBox(64, 64, data)).toBeNull();
  });

  it('treats transparent pixels as background', () => {
    // Opaque black square in the middle; everything else fully transparent.
    const data = new Uint8Array(64 * 64 * 4); // all zero: transparent
    for (let y = 24; y < 40; y++) {
      for (let x = 24; x < 40; x++) {
        const i = (y * 64 + x) * 4;
        data[i + 3] = 255; // opaque black
      }
    }
    expect(computeContentBBox(64, 64, data)).toEqual({ x: 24, y: 24, width: 16, height: 16 });
  });

  it('ignores near-white JPEG noise within the threshold', () => {
    const data = makeImage(64, 64, (set) => {
      // noise just off-white (distance <= threshold) across the canvas
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) set(x, y, 240, 242, 241);
      // real content
      for (let y = 30; y < 34; y++) for (let x = 30; x < 34; x++) set(x, y, 0, 0, 0);
    });
    expect(computeContentBBox(64, 64, data)).toEqual({ x: 30, y: 30, width: 4, height: 4 });
  });
});
