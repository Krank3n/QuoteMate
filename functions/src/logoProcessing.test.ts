/**
 * Server-side logo pipeline. The interesting cases are the ones where the two
 * variants must differ — and the ones where there must not be a second variant
 * at all, because producing one would hand the tradie an invisible logo.
 */
import { describe, expect, it } from 'vitest';
import { processLogo, trimToArtwork, encodePng, decodeImage, DecodedImage } from './logoProcessing';

function image(w: number, h: number, r: number, g: number, b: number, a = 255): DecodedImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  return { width: w, height: h, data };
}

function paint(
  img: DecodedImage,
  x0: number, y0: number, x1: number, y1: number,
  r: number, g: number, b: number, a = 255,
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
    }
  }
}

describe('trimToArtwork', () => {
  it('crops a wordmark off its padded canvas', () => {
    // Jake's case in miniature: wide artwork, tall empty canvas.
    const img = image(120, 120, 255, 255, 255);
    paint(img, 10, 52, 110, 68, 20, 20, 20);
    const out = trimToArtwork(img);
    expect(out.height).toBeLessThan(40);   // was 120
    expect(out.width).toBeGreaterThan(90); // artwork kept
  });

  it('leaves full-bleed artwork alone', () => {
    const img = image(40, 40, 30, 60, 120);
    expect(trimToArtwork(img).height).toBe(40);
  });
});

describe('processLogo', () => {
  it('offers a background-removed variant for dark-on-light', () => {
    const img = image(80, 80, 255, 255, 255);
    paint(img, 20, 30, 60, 50, 25, 25, 25);
    const out = processLogo(img);
    expect(out.background).toBe('light');
    expect(out.noBackground).toBeDefined();
    expect(out.recommendNoBackground).toBe(true);
  });

  it('still OFFERS the variant for light-on-dark, but does not recommend it', () => {
    // Nothing is destroyed by offering — the original is kept alongside, and
    // the preview shows the logo all but vanishing, which argues the case
    // better than hiding the option would.
    const img = image(80, 80, 18, 22, 30);
    paint(img, 20, 30, 60, 50, 245, 245, 245);
    const out = processLogo(img);
    expect(out.background).toBe('dark');
    expect(out.noBackground).toBeDefined();
    expect(out.recommendNoBackground).toBe(false);
  });

  it('offers nothing for a photo — no single background to take', () => {
    const img = image(80, 80, 128, 128, 128);
    for (let x = 0; x < 80; x++) {
      const v = (x * 37) % 256;
      paint(img, x, 0, x, 0, v, v, v);
      paint(img, x, 79, x, 79, 255 - v, 255 - v, 255 - v);
    }
    const out = processLogo(img);
    expect(out.background).toBe('busy');
    expect(out.noBackground).toBeUndefined();
  });

  it('always returns a usable original', () => {
    const img = image(80, 80, 18, 22, 30);
    paint(img, 20, 30, 60, 50, 245, 245, 245);
    expect(processLogo(img).original.data.length).toBeGreaterThan(0);
  });

  it('the removed-background variant really is transparent at its edge', () => {
    const img = image(80, 80, 255, 255, 255);
    paint(img, 20, 30, 60, 50, 25, 25, 25);
    const { noBackground } = processLogo(img);
    expect(noBackground!.data[3]).toBe(0); // top-left alpha
  });
});

describe('encode/decode round trip', () => {
  it('survives PNG encoding with alpha intact', () => {
    const img = image(16, 16, 10, 20, 30, 0);
    paint(img, 4, 4, 11, 11, 200, 100, 50, 255);
    const back = decodeImage(encodePng(img));
    expect(back.width).toBe(16);
    expect(back.data[3]).toBe(0);                       // transparent corner
    expect(back.data[(6 * 16 + 6) * 4 + 3]).toBe(255);  // opaque centre
    expect(back.data[(6 * 16 + 6) * 4]).toBe(200);
  });
});
