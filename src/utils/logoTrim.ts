/**
 * Auto-trim uniform whitespace margins from uploaded logos.
 *
 * The classic support ticket: a tradie's logo is a wide wordmark exported
 * onto a big square canvas (or a photo of the logo on paper). On the PDF it
 * scales to fit the header box *including* the empty margins, so the artwork
 * prints tiny no matter how they resize the file. Trimming at upload means
 * the artwork itself fills the header.
 *
 * Works on Android, iOS and web with no native code: expo-image-manipulator
 * produces a tiny JPEG probe (alpha flattened onto white), jpeg-js decodes
 * it to pixels, a pure bbox scan finds the artwork, then the full-size image
 * is cropped with a small breathing room. Detection runs at <=128px so the
 * whole thing costs a few milliseconds.
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import { computeContentBBox } from '../../shared/logo/trimCore';

/** Detection probe resolution — plenty for finding margins. */
const PROBE_WIDTH = 128;
/** Breathing room kept around the artwork, as a fraction of its longer side. */
const PAD_FRACTION = 0.05;

/** base64 → Uint8Array without Node's Buffer (Hermes has no Buffer global). */
function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const clean = base64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let outIdx = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = lookup[clean.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIdx++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, outIdx);
}

/**
 * Trim uniform whitespace margins off a logo image. Returns a new cropped
 * local URI, or the original URI when there's nothing worth trimming (or if
 * detection fails — trimming must never break an upload).
 */
export async function trimLogoWhitespace(uri: string): Promise<string> {
  try {
    // Probe at detection resolution. JPEG flattens any alpha onto white,
    // which is exactly the background the PDF composites onto.
    const probe = await manipulateAsync(uri, [{ resize: { width: PROBE_WIDTH } }], {
      compress: 0.7,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (!probe.base64 || probe.width <= 0 || probe.height <= 0) return uri;

    const decoded = jpeg.decode(base64ToBytes(probe.base64) as any, {
      maxMemoryUsageInMB: 16,
      formatAsRGBA: true,
    });
    const bbox = computeContentBBox(decoded.width, decoded.height, decoded.data);
    if (!bbox) return uri;

    // Map probe coordinates back onto the full image.
    const full = await manipulateAsync(uri, [], { format: SaveFormat.PNG });
    const scaleX = full.width / decoded.width;
    const scaleY = full.height / decoded.height;

    const pad = Math.round(Math.max(bbox.width * scaleX, bbox.height * scaleY) * PAD_FRACTION);
    const originX = Math.max(0, Math.floor(bbox.x * scaleX) - pad);
    const originY = Math.max(0, Math.floor(bbox.y * scaleY) - pad);
    const cropWidth = Math.min(full.width - originX, Math.ceil(bbox.width * scaleX) + pad * 2);
    const cropHeight = Math.min(full.height - originY, Math.ceil(bbox.height * scaleY) + pad * 2);
    if (cropWidth <= 0 || cropHeight <= 0) return uri;

    const cropped = await manipulateAsync(
      uri,
      [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
      { format: SaveFormat.PNG },
    );
    return cropped.uri;
  } catch {
    // Detection is best-effort — a weird file must never block the upload.
    return uri;
  }
}
