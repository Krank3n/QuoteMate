import { describe, it, expect, beforeEach } from 'vitest';
import { PNG } from 'pngjs';
import {
  emailSafeLogoUrl,
  flattenOnTile,
  flattenOnWhite,
  tileFor,
  artworkLuma,
  hexToRgb,
  storageObject,
  downloadUrl,
  DARK_TILE,
  EmailLogoStorage,
  _resetEmailLogoMemo,
} from './emailLogo';
import { decodeImage } from './logoProcessing';

const BUCKET = 'hansendev.firebasestorage.app';
const NOBG = 'users/uid1/logo-uploads/123-abc-nobg.png';
const FLAT_WHITE = 'users/uid1/logo-uploads/123-abc-nobg-flat-ffffff.png';
const FLAT_BRAND = 'users/uid1/logo-uploads/123-abc-nobg-flat-0b3a5a.png';
const FLAT_DARK = 'users/uid1/logo-uploads/123-abc-nobg-flat-0f172a.png';
const SRC_URL = downloadUrl(BUCKET, NOBG, 'tok-src');

function png(pixels: number[][], width = pixels.length, height = 1): Buffer {
  const img = new PNG({ width, height });
  pixels.forEach((p, i) => { img.data[i * 4] = p[0]; img.data[i * 4 + 1] = p[1]; img.data[i * 4 + 2] = p[2]; img.data[i * 4 + 3] = p[3]; });
  return PNG.sync.write(img);
}
const px = (img: { data: Uint8Array; width: number }, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/** A fake bucket: files are Buffers, tokens are what `save` was given. */
function fakeStorage(files: Record<string, Buffer>, tokens: Record<string, string> = {}) {
  const calls = { downloads: 0, saves: 0 };
  const storage: EmailLogoStorage = {
    async exists(_b, name) { return name in files; },
    async downloadToken(_b, name) { return tokens[name]; },
    async download(_b, name) { calls.downloads++; const f = files[name]; if (!f) throw new Error('not found'); return f; },
    async save(_b, name, buf, token) { calls.saves++; files[name] = buf; tokens[name] = token; },
  };
  return { storage, files, tokens, calls };
}

beforeEach(() => _resetEmailLogoMemo());

describe('flattenOnTile', () => {
  it('pads the artwork on the tile, turns transparent pixels into the tile and blends partial alpha', () => {
    const img = decodeImage(png([[0, 0, 0, 0], [0, 0, 0, 128], [20, 40, 60, 255]]));
    const flat = flattenOnTile(img, [255, 255, 255])!;
    // 3x1 source, 8px minimum padding on every side
    expect([flat.width, flat.height]).toEqual([19, 17]);
    expect(px(flat, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(flat, 8, 8)).toEqual([255, 255, 255, 255]);
    expect(px(flat, 9, 8)).toEqual([127, 127, 127, 255]);
    expect(px(flat, 10, 8)).toEqual([20, 40, 60, 255]);
  });

  it('blends onto a coloured tile', () => {
    const flat = flattenOnTile(decodeImage(png([[255, 255, 255, 128]])), [0, 0, 0])!;
    expect(px(flat, 8, 8)).toEqual([128, 128, 128, 255]);
    expect(px(flat, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it('returns null for a fully opaque image so the original file keeps serving', () => {
    expect(flattenOnWhite(decodeImage(png([[1, 2, 3, 255], [4, 5, 6, 255]])))).toBeNull();
  });
});

describe('tileFor', () => {
  const dark = decodeImage(png([[11, 58, 90, 255], [0, 0, 0, 0]]));
  const light = decodeImage(png([[255, 255, 255, 255], [240, 240, 240, 255], [0, 0, 0, 0]]));
  it('is white behind ordinary artwork, whatever the brand colour', () => {
    expect(tileFor(dark, '#0b3a5a')).toEqual([255, 255, 255]);
    expect(tileFor(dark, undefined)).toEqual([255, 255, 255]);
  });
  it('is the brand colour behind light artwork', () => {
    expect(tileFor(light, '#0b3a5a')).toEqual([11, 58, 90]);
  });
  it('falls back to the dark neutral when the brand colour is missing, malformed or itself light', () => {
    expect(tileFor(light, undefined)).toEqual(hexToRgb(DARK_TILE));
    expect(tileFor(light, 'red')).toEqual(hexToRgb(DARK_TILE));
    expect(tileFor(light, '#fafafa')).toEqual(hexToRgb(DARK_TILE));
  });
  it('ignores fully transparent pixels when judging lightness', () => {
    expect(artworkLuma(decodeImage(png([[255, 255, 255, 0], [0, 0, 0, 255]])))).toBe(0);
    expect(artworkLuma(decodeImage(png([[255, 255, 255, 0]])))).toBeNull();
  });
});

describe('storageObject', () => {
  it('parses our Firebase Storage download URLs and decodes the object name', () => {
    expect(storageObject(SRC_URL)).toEqual({ bucket: BUCKET, name: NOBG });
  });
  it('rejects anything else', () => {
    expect(storageObject('https://cdn.example.com/logo.png')).toBeNull();
    expect(storageObject('https://firebasestorage.googleapis.com/v0/b/x/o/%E0%A4%A')).toBeNull();
  });
});

describe('emailSafeLogoUrl', () => {
  it('passes through a non-http value, an outside host, a non-PNG and an already-flattened file untouched', async () => {
    const { storage, calls } = fakeStorage({});
    expect(await emailSafeLogoUrl('file:///var/mobile/logo.png', undefined, storage)).toBeUndefined();
    expect(await emailSafeLogoUrl('', undefined, storage)).toBeUndefined();
    expect(await emailSafeLogoUrl('https://cdn.example.com/logo.png', undefined, storage)).toBe('https://cdn.example.com/logo.png');
    const jpg = downloadUrl(BUCKET, 'users/uid1/logo.jpg', 't');
    expect(await emailSafeLogoUrl(jpg, undefined, storage)).toBe(jpg);
    const flat = downloadUrl(BUCKET, FLAT_WHITE, 't');
    expect(await emailSafeLogoUrl(flat, '#0b3a5a', storage)).toBe(flat);
    expect(calls.downloads).toBe(0);
  });

  it('writes a white-tile sibling for ordinary transparent artwork and returns its tokenised URL', async () => {
    const { storage, files, tokens, calls } = fakeStorage({ [NOBG]: png([[0, 0, 0, 0], [10, 20, 30, 255]]) });
    const out = await emailSafeLogoUrl(SRC_URL, '#0b3a5a', storage);
    expect(calls.saves).toBe(1);
    expect(files[FLAT_WHITE]).toBeDefined();
    expect(out).toBe(downloadUrl(BUCKET, FLAT_WHITE, tokens[FLAT_WHITE]));
    const written = decodeImage(files[FLAT_WHITE]);
    expect(px(written, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(written, 9, 8)).toEqual([10, 20, 30, 255]);
  });

  it('writes a brand-colour sibling for light artwork, and a dark one when there is no brand colour', async () => {
    const light = png([[255, 255, 255, 255], [0, 0, 0, 0]]);
    const a = fakeStorage({ [NOBG]: light });
    expect(await emailSafeLogoUrl(SRC_URL, '#0B3A5A', a.storage)).toBe(downloadUrl(BUCKET, FLAT_BRAND, a.tokens[FLAT_BRAND]));
    expect(px(decodeImage(a.files[FLAT_BRAND]), 0, 0)).toEqual([11, 58, 90, 255]);
    const b = fakeStorage({ [NOBG]: light });
    expect(await emailSafeLogoUrl(SRC_URL, undefined, b.storage)).toBe(downloadUrl(BUCKET, FLAT_DARK, b.tokens[FLAT_DARK]));
  });

  it('reuses an existing flattened file without writing again', async () => {
    const { storage, calls } = fakeStorage(
      { [NOBG]: png([[0, 0, 0, 0], [10, 20, 30, 255]]), [FLAT_WHITE]: Buffer.alloc(0) },
      { [FLAT_WHITE]: 'existing-token' },
    );
    expect(await emailSafeLogoUrl(SRC_URL, undefined, storage)).toBe(downloadUrl(BUCKET, FLAT_WHITE, 'existing-token'));
    expect(calls.saves).toBe(0);
  });

  it('keeps the original URL for an opaque PNG and writes nothing', async () => {
    const { storage, calls } = fakeStorage({ [NOBG]: png([[1, 2, 3, 255]]) });
    expect(await emailSafeLogoUrl(SRC_URL, undefined, storage)).toBe(SRC_URL);
    expect(calls.saves).toBe(0);
  });

  it('memoises per process and per brand colour so a repeat send makes no Storage calls', async () => {
    const { storage, calls } = fakeStorage({ [NOBG]: png([[0, 0, 0, 0]]) });
    const first = await emailSafeLogoUrl(SRC_URL, '#0b3a5a', storage);
    const second = await emailSafeLogoUrl(SRC_URL, '#0b3a5a', storage);
    expect(second).toBe(first);
    expect(calls.downloads).toBe(1);
    await emailSafeLogoUrl(SRC_URL, '#111111', storage);
    expect(calls.downloads).toBe(2);
  });

  it('serves the original when Storage throws, and logs it', async () => {
    const logs: string[] = [];
    const storage: EmailLogoStorage = {
      async exists() { throw new Error('boom'); },
      async downloadToken() { return undefined; },
      async download() { throw new Error('boom'); },
      async save() { /* unreachable */ },
    };
    expect(await emailSafeLogoUrl(SRC_URL, undefined, storage, { log: (m) => logs.push(m) })).toBe(SRC_URL);
    expect(logs[0]).toContain('serving the original logo');
  });

  it('serves the original when Storage is slower than the budget', async () => {
    const storage: EmailLogoStorage = {
      async exists() { return false; },
      async downloadToken() { return undefined; },
      download: () => new Promise(() => { /* never */ }),
      async save() { /* unreachable */ },
    };
    expect(await emailSafeLogoUrl(SRC_URL, undefined, storage, { budgetMs: 20 })).toBe(SRC_URL);
  });
});
