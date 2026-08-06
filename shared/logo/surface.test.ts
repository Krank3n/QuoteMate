/**
 * The rule these tests exist to protect: a logo's background is only safe to
 * remove when the artwork is DARKER than it. Light-on-dark logos (31% of real
 * accounts) must keep their plate — stripping it leaves white artwork on cream
 * paper, i.e. nothing at all.
 */
import { describe, expect, it } from 'vitest';
import { analyzeLogoSurface, removeUniformBackground, stripBackground, haloRisk } from './surface';

/** RGBA canvas filled with one colour. */
function canvas(w: number, h: number, r: number, g: number, b: number, a = 255): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  return d;
}

function fill(
  d: Uint8Array, w: number,
  x0: number, y0: number, x1: number, y1: number,
  r: number, g: number, b: number, a = 255,
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
  }
}

const alphaAt = (d: Uint8Array, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3];

describe('analyzeLogoSurface', () => {
  it('reads a transparent border as already clean', () => {
    const d = canvas(40, 40, 0, 0, 0, 0);
    fill(d, 40, 12, 16, 28, 24, 20, 20, 20);
    const s = analyzeLogoSurface(40, 40, d);
    expect(s.background).toBe('transparent');
    expect(s.canStripBackground).toBe(false); // nothing to do
  });

  it('dark artwork on a white plate is safe to strip', () => {
    const d = canvas(40, 40, 255, 255, 255);
    fill(d, 40, 10, 16, 30, 24, 25, 25, 25);
    const s = analyzeLogoSurface(40, 40, d);
    expect(s.background).toBe('light');
    expect(s.canStripBackground).toBe(true);
  });

  it('light artwork on a dark plate must NOT be stripped', () => {
    // bunya / ASCEND / AKF shape: white wordmark on near-black.
    const d = canvas(40, 40, 16, 20, 28);
    fill(d, 40, 10, 16, 30, 24, 245, 245, 245);
    const s = analyzeLogoSurface(40, 40, d);
    expect(s.background).toBe('dark');
    expect(s.canStripBackground).toBe(false);
  });

  it('a photographed logo is left alone', () => {
    const d = canvas(40, 40, 128, 128, 128);
    // noisy border — no single background colour to drop
    for (let x = 0; x < 40; x++) {
      const v = (x * 37) % 256;
      fill(d, 40, x, 0, x, 0, v, v, v);
      fill(d, 40, x, 39, x, 39, 255 - v, 255 - v, 255 - v);
    }
    const s = analyzeLogoSurface(40, 40, d);
    expect(s.background).toBe('busy');
    expect(s.canStripBackground).toBe(false);
  });
});

describe('removeUniformBackground', () => {
  it('clears the plate and keeps the artwork', () => {
    const d = canvas(40, 40, 255, 255, 255);
    fill(d, 40, 10, 16, 30, 24, 25, 25, 25);
    const s = analyzeLogoSurface(40, 40, d);
    const out = removeUniformBackground(40, 40, d, s)!;
    expect(out).not.toBeNull();
    expect(alphaAt(out, 40, 0, 0)).toBe(0);    // corner cleared
    expect(alphaAt(out, 40, 20, 20)).toBe(255); // artwork kept
  });

  it('refuses when the surface says it is unsafe', () => {
    const d = canvas(40, 40, 16, 20, 28);
    fill(d, 40, 10, 16, 30, 24, 245, 245, 245);
    const s = analyzeLogoSurface(40, 40, d);
    expect(removeUniformBackground(40, 40, d, s)).toBeNull();
  });

  it('stripBackground still produces it, so the tradie can choose', () => {
    // Same unsafe logo. Availability and recommendation are different
    // questions: nothing is destroyed, and the preview makes the case.
    const d = canvas(40, 40, 16, 20, 28);
    fill(d, 40, 10, 16, 30, 24, 245, 245, 245);
    const s = analyzeLogoSurface(40, 40, d);
    const out = stripBackground(40, 40, d, s);
    expect(out).not.toBeNull();
    expect(alphaAt(out!, 40, 0, 0)).toBe(0);
    expect(alphaAt(out!, 40, 20, 20)).toBe(255);
  });

  it('stripBackground declines a transparent logo and a photo', () => {
    const clear = canvas(40, 40, 0, 0, 0, 0);
    fill(clear, 40, 12, 16, 28, 24, 20, 20, 20);
    expect(stripBackground(40, 40, clear, analyzeLogoSurface(40, 40, clear))).toBeNull();

    const busy = canvas(40, 40, 128, 128, 128);
    for (let x = 0; x < 40; x++) {
      const v = (x * 37) % 256;
      fill(busy, 40, x, 0, x, 0, v, v, v);
      fill(busy, 40, x, 39, x, 39, 255 - v, 255 - v, 255 - v);
    }
    expect(stripBackground(40, 40, busy, analyzeLogoSurface(40, 40, busy))).toBeNull();
  });

  it('does not punch holes in enclosed same-coloured artwork', () => {
    // Dark ring with a white centre — the centre must survive, because a
    // global colour match would wrongly clear it along with the border.
    const d = canvas(40, 40, 255, 255, 255);
    fill(d, 40, 8, 8, 32, 32, 30, 30, 30);     // dark block
    fill(d, 40, 16, 16, 24, 24, 255, 255, 255); // white hole inside it
    const s = analyzeLogoSurface(40, 40, d);
    const out = removeUniformBackground(40, 40, d, s)!;
    expect(alphaAt(out, 40, 0, 0)).toBe(0);     // outer plate cleared
    expect(alphaAt(out, 40, 20, 20)).toBe(255); // enclosed white kept
  });

  it('refuses a cut that would leave a ragged halo', () => {
    // A textured / JPEG-noisy plate: the tight tolerance stops at a ring of
    // intermediate tone hugging the artwork, so the cut would come out looking
    // like a badly scissored sticker. Real case: the HOBAN badge, halo risk
    // 0.41 against a 0.15 guard.
    const d = canvas(80, 80, 250, 250, 250);
    fill(d, 80, 14, 14, 66, 66, 210, 210, 210); // halo the tight fill can't cross
    fill(d, 80, 20, 20, 60, 60, 20, 20, 20);    // the actual artwork
    const s = analyzeLogoSurface(80, 80, d);
    expect(s.canStripBackground).toBe(true);    // passes the darkness gate...
    expect(removeUniformBackground(80, 80, d, s)).toBeNull(); // ...but not the halo gate
  });

  it('a flat plate has negligible halo risk', () => {
    const d = canvas(80, 80, 255, 255, 255);
    fill(d, 80, 20, 20, 60, 60, 25, 25, 25);
    expect(haloRisk(80, 80, d, { r: 255, g: 255, b: 255 })).toBeLessThan(0.15);
  });

  it('leaves the source buffer untouched', () => {
    const d = canvas(40, 40, 255, 255, 255);
    fill(d, 40, 10, 16, 30, 24, 25, 25, 25);
    const before = d.slice();
    removeUniformBackground(40, 40, d, analyzeLogoSurface(40, 40, d));
    expect(d).toEqual(before);
  });
});
