/**
 * Server-side logo processing.
 *
 * The client can crop and resize (expo-image-manipulator) but cannot write
 * pixels, so background removal has to happen here. Doing it server-side also
 * means web and native behave identically, and the backfill for existing
 * accounts runs the exact same code as a fresh upload.
 *
 * The decision of *whether* to drop a background lives in shared/logo/surface —
 * see the note there on why "strip the background" is wrong for a third of
 * real logos. This module is the plumbing around it: decode, trim, strip,
 * re-encode, store both variants so the tradie can pick.
 */

import * as admin from 'firebase-admin';
import { PNG } from 'pngjs';
import * as jpeg from 'jpeg-js';
import { computeContentBBox } from './shared/logo/trimCore';
import { analyzeLogoSurface, stripBackground, LogoBackground } from './shared/logo/surface';

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA */
  data: Uint8Array;
}

/** Breathing room kept around trimmed artwork, as a fraction of its longer side. */
const PAD_FRACTION = 0.05;

export function decodeImage(buf: Buffer): DecodedImage {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  }
  const raw = jpeg.decode(buf, { formatAsRGBA: true, maxMemoryUsageInMB: 64 } as any);
  return { width: raw.width, height: raw.height, data: new Uint8Array(raw.data) };
}

export function encodePng(img: DecodedImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  Buffer.from(img.data).copy(png.data);
  return PNG.sync.write(png);
}

/** Crop to the artwork, keeping a little breathing room. Returns the input when
 *  there is no meaningful margin to remove. */
export function trimToArtwork(img: DecodedImage): DecodedImage {
  const bbox = computeContentBBox(img.width, img.height, img.data);
  if (!bbox) return img;

  const pad = Math.round(Math.max(bbox.width, bbox.height) * PAD_FRACTION);
  const x = Math.max(0, bbox.x - pad);
  const y = Math.max(0, bbox.y - pad);
  const w = Math.min(img.width - x, bbox.width + pad * 2);
  const h = Math.min(img.height - y, bbox.height + pad * 2);
  if (w <= 0 || h <= 0) return img;

  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * img.width + x) * 4;
    out.set(img.data.subarray(src, src + w * 4), row * w * 4);
  }
  return { width: w, height: h, data: out };
}

export interface ProcessedLogo {
  /** The tidied original: trimmed, background left alone. */
  original: DecodedImage;
  /**
   * Background removed. Offered whenever a clean cut is possible — including
   * when we would not recommend it — because the tradie can see the result and
   * the original is kept either way. Absent only when there is no single
   * background to take, or the cut would come out torn.
   */
  noBackground?: DecodedImage;
  background: LogoBackground;
  /** True when the background-removed variant should be the default. */
  recommendNoBackground: boolean;
  /**
   * Why there is no variant, when there isn't one. Distinct from `background`:
   * a dark logo can have a perfectly cuttable plate, and a light one can be
   * refused for a ragged edge. Reporting the classification instead of the
   * actual reason tells the tradie the wrong story.
   */
  noBackgroundReason?: 'transparent' | 'busy' | 'ragged';
}

/**
 * Produce both variants of a logo.
 *
 * Order matters: strip first, then trim. The trim detector only recognises
 * transparent and near-white as background, so a plate that is merely lightish
 * (#EEE, a cream export) leaves it finding no margin and refusing to crop.
 * Clearing the plate first turns those borders transparent, and the trim then
 * works on exactly the artwork.
 *
 * Note the two variants are trimmed independently, so the untouched original
 * still gets whatever crop its own margins allow.
 */
export function processLogo(source: DecodedImage): ProcessedLogo {
  const surface = analyzeLogoSurface(source.width, source.height, source.data);
  // Offer the variant whenever a clean cut exists; the surface analysis decides
  // only which one is preselected.
  const stripped = stripBackground(source.width, source.height, source.data, surface);

  const original = trimToArtwork(source);
  const noBackground = stripped
    ? trimToArtwork({ width: source.width, height: source.height, data: stripped })
    : undefined;

  return {
    original,
    noBackground,
    background: surface.background,
    recommendNoBackground: !!noBackground && surface.canStripBackground,
    noBackgroundReason: noBackground
      ? undefined
      : surface.background === 'transparent'
        ? 'transparent'
        : surface.background === 'busy'
          ? 'busy'
          : // There was a single background colour, so the only other way to
            // get here is the halo guard rejecting the cut as too ragged.
            'ragged',
  };
}

export interface StoredLogoVariants {
  originalUrl: string;
  noBackgroundUrl?: string;
  background: LogoBackground;
  recommendNoBackground: boolean;
  noBackgroundReason?: 'transparent' | 'busy' | 'ragged';
}

/**
 * Process the logo already uploaded at `sourcePath` and write both variants
 * beside it. Returns download URLs for each.
 *
 * Variants are written next to the source rather than to the canonical
 * users/<uid>/logo.png, because this runs while the tradie is still deciding.
 * Clobbering the canonical path here would replace the logo currently on all
 * their documents before they had agreed to anything — including if they then
 * closed the screen without saving. Settings point at whichever URL they pick.
 */
export async function processAndStoreLogo(
  uid: string,
  sourcePath: string,
): Promise<StoredLogoVariants> {
  const bucket = admin.storage().bucket();
  const [buf] = await bucket.file(sourcePath).download();
  const processed = processLogo(decodeImage(buf));

  const stem = sourcePath.replace(/\.[^./]+$/, '');
  const write = async (suffix: string, img: DecodedImage): Promise<string> => {
    const file = bucket.file(`${stem}-${suffix}.png`);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await file.save(encodePng(img), {
      contentType: 'image/png',
      resumable: false,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    return (
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(file.name)}?alt=media&token=${token}`
    );
  };

  const originalUrl = await write('original', processed.original);
  const noBackgroundUrl = processed.noBackground
    ? await write('nobg', processed.noBackground)
    : undefined;

  return {
    originalUrl,
    noBackgroundUrl,
    background: processed.background,
    recommendNoBackground: processed.recommendNoBackground,
    noBackgroundReason: processed.noBackgroundReason,
  };
}
