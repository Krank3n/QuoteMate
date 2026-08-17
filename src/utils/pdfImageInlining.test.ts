/**
 * The broken-image box that printed in the logo slot of customer quotes.
 *
 * PDFs inline their images as base64 data URIs, because a remote <img src>
 * hangs Android's print bridge and races expo-print's iOS snapshot. The
 * download used FileSystem.downloadAsync — which does NOT throw on an HTTP
 * error. It writes the response BODY to the file and resolves. Nothing checked
 * `status`, so a 404 from Firebase Storage was base64-encoded and embedded as:
 *
 *   data:image/png;base64,<the 404 JSON>
 *
 * Every print renderer draws that as a broken-image icon. Observed live on
 * 17 Aug 2026: this account's stored logo object is gone (Storage returns
 * `{"error":{"code":404,"message":"Not Found."}}`) and the error body was
 * inlined in its place, on every quote the tradie previewed or sent.
 *
 * imageMimeFromBase64 is the second guard — it catches a 200 that still isn't
 * an image (an HTML error page, a captive portal, a zero-byte file), and gives
 * the data URI the correct mime instead of always claiming PNG.
 */
import { describe, it, expect } from 'vitest';
import { imageMimeFromBase64 } from './imageMime';

/** base64 of the exact body Firebase Storage returned for the missing logo. */
const STORAGE_404 = Buffer.from(
  '{\n  "error": {\n    "code": 404,\n    "message": "Not Found."\n  }\n}',
).toString('base64');

describe('imageMimeFromBase64', () => {
  describe('rejects what is not an image', () => {
    it('rejects the Storage 404 body that printed as a broken logo', () => {
      // Sanity-check the fixture really is the payload from the live bug.
      expect(STORAGE_404.startsWith('ewogICJlcnJvciI6')).toBe(true);
      expect(imageMimeFromBase64(STORAGE_404)).toBeNull();
    });

    it('rejects an HTML error page served with a 200', () => {
      const html = Buffer.from('<!DOCTYPE html><html><body>Forbidden</body></html>').toString('base64');
      expect(imageMimeFromBase64(html)).toBeNull();
    });

    it('rejects an empty body', () => {
      expect(imageMimeFromBase64('')).toBeNull();
    });

    it('rejects a plain-text body', () => {
      expect(imageMimeFromBase64(Buffer.from('Not Found').toString('base64'))).toBeNull();
    });
  });

  describe('identifies real images by their leading bytes', () => {
    const cases: [string, number[], string][] = [
      ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00], 'image/png'],
      ['JPEG', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46], 'image/jpeg'],
      ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00], 'image/gif'],
      ['WebP', [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], 'image/webp'],
    ];

    for (const [name, bytes, mime] of cases) {
      it(`identifies ${name} as ${mime}`, () => {
        expect(imageMimeFromBase64(Buffer.from(bytes).toString('base64'))).toBe(mime);
      });
    }

    it('does not mislabel a JPEG as PNG the way the old hardcoded mime did', () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
      expect(imageMimeFromBase64(jpeg)).not.toBe('image/png');
    });
  });
});
