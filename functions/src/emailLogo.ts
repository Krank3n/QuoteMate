/**
 * A flattened copy of the tradie's logo for customer emails.
 *
 * Most tradie logos are background-removed PNGs. The remover clears only the
 * white that touches the outer edge, so the counters of closed letters (O, B,
 * A, R, D) keep their white and any transparent PNG can carry a stray
 * semi-transparent fringe. On a light page none of that shows. The Gmail app
 * in dark mode ignores the template's light-only colour scheme and inverts
 * every background, including an inline white tile behind the image, and the
 * islands then sit as bright specks on near-black. Images are the one thing
 * it leaves alone, so the fix is to bake the white into the pixels.
 *
 * `emailSafeLogoUrl` takes the URL the settings point at and returns the URL
 * of a `-flat-<hex>.png` sibling in the same Storage folder, writing it on
 * first use and reusing it after. The tile is white unless the artwork is
 * itself light (a white wordmark lifted off a dark website header), in which
 * case it is the tradie's brand colour, so the logo stays visible on a white
 * card. A little padding keeps the tile from hugging the artwork, which is
 * what a dark-mode reader sees. Anything that isn't a transparent PNG in our
 * bucket comes back unchanged, and so does the original on any failure: a
 * logo quirk must never block a customer send.
 */

import * as admin from 'firebase-admin';
import { decodeImage, encodePng, DecodedImage } from './logoProcessing';

export const FLAT_SUFFIX = '-flat';
/** Tile behind light artwork when the tradie has no usable brand colour. */
export const DARK_TILE = '#0f172a';
/** Artwork whose opaque pixels average above this luminance is "light". */
const LIGHT_LUMA = 200;
/** Tile padding as a fraction of the longer side, with a floor in pixels. */
const PAD_FRACTION = 0.06;
const PAD_MIN = 8;

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mean luminance of the pixels that carry any ink; null when the image is empty. */
export function artworkLuma(img: DecodedImage): number | null {
  const d = img.data;
  let sum = 0; let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    n++;
  }
  return n ? sum / n : null;
}

/** White for most logos; the brand colour (or a dark neutral) behind light artwork. */
export function tileFor(img: DecodedImage, brandColor?: string | null): [number, number, number] {
  const luma = artworkLuma(img);
  if (luma === null || luma < LIGHT_LUMA) return [255, 255, 255];
  const brand = hexToRgb(brandColor || '');
  // A light brand colour would hide light artwork just as white does.
  if (brand && 0.2126 * brand[0] + 0.7152 * brand[1] + 0.0722 * brand[2] < LIGHT_LUMA) return brand;
  return hexToRgb(DARK_TILE)!;
}

/** `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded object>?alt=media&token=…` */
export function storageObject(url: string): { bucket: string; name: string } | null {
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/i.exec(url);
  if (!m) return null;
  try {
    return { bucket: m[1], name: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}

/**
 * Composite onto an opaque tile with a little padding around the artwork.
 * Returns null when nothing is transparent, so the caller keeps serving the
 * original file (an opaque upload already is its own tile).
 */
export function flattenOnTile(img: DecodedImage, tile: [number, number, number]): DecodedImage | null {
  const src = img.data;
  let transparent = false;
  for (let i = 3; i < src.length; i += 4) {
    if (src[i] < 255) { transparent = true; break; }
  }
  if (!transparent) return null;
  const pad = Math.max(PAD_MIN, Math.round(Math.max(img.width, img.height) * PAD_FRACTION));
  const width = img.width + pad * 2;
  const height = img.height + pad * 2;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = tile[0]; out[i + 1] = tile[1]; out[i + 2] = tile[2]; out[i + 3] = 255;
  }
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4;
      const oi = ((y + pad) * width + (x + pad)) * 4;
      const a = src[si + 3] / 255;
      out[oi] = Math.round(src[si] * a + tile[0] * (1 - a));
      out[oi + 1] = Math.round(src[si + 1] * a + tile[1] * (1 - a));
      out[oi + 2] = Math.round(src[si + 2] * a + tile[2] * (1 - a));
    }
  }
  return { width, height, data: out };
}

/** Kept for callers that only need the maths; the tile is white. */
export function flattenOnWhite(img: DecodedImage): DecodedImage | null {
  return flattenOnTile(img, [255, 255, 255]);
}

export interface EmailLogoStorage {
  exists(bucket: string, name: string): Promise<boolean>;
  downloadToken(bucket: string, name: string): Promise<string | undefined>;
  download(bucket: string, name: string): Promise<Buffer>;
  save(bucket: string, name: string, png: Buffer, token: string): Promise<void>;
}

function adminStorage(): EmailLogoStorage {
  const file = (bucket: string, name: string) => admin.storage().bucket(bucket).file(name);
  return {
    async exists(bucket, name) {
      const [ok] = await file(bucket, name).exists();
      return ok;
    },
    async downloadToken(bucket, name) {
      const [meta] = await file(bucket, name).getMetadata();
      const tokens = String((meta as any)?.metadata?.firebaseStorageDownloadTokens || '');
      return tokens.split(',')[0] || undefined;
    },
    async download(bucket, name) {
      const [buf] = await file(bucket, name).download();
      return buf;
    },
    async save(bucket, name, png, token) {
      await file(bucket, name).save(png, {
        contentType: 'image/png',
        resumable: false,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
    },
  };
}

export function downloadUrl(bucket: string, name: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(name)}?alt=media&token=${token}`;
}

/** One answer per source URL per process: sends in the same instance skip the round trips. */
const memo = new Map<string, string>();

/** The send must not wait on Storage for long; past this the original URL goes out. */
const BUDGET_MS = 6000;

export async function emailSafeLogoUrl(
  url: string | null | undefined,
  brandColor?: string | null,
  storage: EmailLogoStorage = adminStorage(),
  opts: { budgetMs?: number; log?: (msg: string, data: Record<string, unknown>) => void } = {},
): Promise<string | undefined> {
  const trimmed = (url || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  const obj = storageObject(trimmed);
  if (!obj) return trimmed;
  if (!/\.png$/i.test(obj.name)) return trimmed;
  if (new RegExp(`${FLAT_SUFFIX}-[0-9a-f]{6}\\.png$`, 'i').test(obj.name)) return trimmed;

  const brand = (brandColor || '').trim().toLowerCase();
  const memoKey = `${trimmed}|${brand}`;
  const cached = memo.get(memoKey);
  if (cached) return cached;

  const log = opts.log || ((msg, data) => console.warn(msg, data));
  const targetFor = (tile: [number, number, number]) =>
    obj.name.replace(/\.png$/i, `${FLAT_SUFFIX}-${tile.map((c) => c.toString(16).padStart(2, '0')).join('')}.png`);

  const work = (async (): Promise<string> => {
    // The tile depends on the artwork, so the source is decoded first; the
    // memo above makes that a once-per-process cost.
    const img = decodeImage(await storage.download(obj.bucket, obj.name));
    const tile = tileFor(img, brand);
    const target = targetFor(tile);
    if (await storage.exists(obj.bucket, target)) {
      const token = await storage.downloadToken(obj.bucket, target);
      return token ? downloadUrl(obj.bucket, target, token) : trimmed;
    }
    const flat = flattenOnTile(img, tile);
    if (!flat) return trimmed;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await storage.save(obj.bucket, target, encodePng(flat), token);
    return downloadUrl(obj.bucket, target, token);
  })();

  // Memoise only a settled answer: a send that hits the budget keeps the
  // original for this call and the next send picks up the finished file.
  const settled = work.then((v) => { memo.set(memoKey, v); return v; });
  settled.catch(() => undefined);

  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(trimmed), opts.budgetMs ?? BUDGET_MS);
  });
  try {
    return await Promise.race([settled, budget]);
  } catch (err: any) {
    log('emailSafeLogoUrl: serving the original logo', { name: obj.name, message: err?.message });
    return trimmed;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Test seam. */
export function _resetEmailLogoMemo(): void {
  memo.clear();
}
