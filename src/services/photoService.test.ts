/**
 * uploadQuotePhoto web-path regression tests.
 *
 * The 21 Aug 2026 incident: a PDF picked through the web file input survived
 * compressImage's decode-failure fallback and was uploaded as raw PDF bytes
 * labelled "image/jpeg", which then 400'd BOTH vision providers and killed
 * materials analysis for the whole quote. These tests pin the fix: uploads
 * are typed from their magic bytes — PDFs upload as real PDFs, unsupported
 * bytes are rejected loudly, never stored under a fake content type.
 *
 * Platform.OS is 'web' here via the react-native → react-native-web alias,
 * which is exactly the branch under test (native pickers can't produce PDFs).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage: unknown, path: string) => ({ path })),
  uploadBytes: vi.fn(async () => undefined),
  getDownloadURL: vi.fn(async (r: { path: string }) => `https://storage.example/${r.path}`),
  deleteObject: vi.fn(async () => undefined),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn()),
}));

import { manipulateAsync } from 'expo-image-manipulator';
import { ref, uploadBytes } from 'firebase/storage';
import { uploadQuotePhoto, UnsupportedPhotoError } from './photoService';

const uploadBytesMock = vi.mocked(uploadBytes);
const refMock = vi.mocked(ref);
const manipulateMock = vi.mocked(manipulateAsync);

/** Point global fetch (the web uriToBlob path) at a blob of the given bytes. */
function serveBlob(bytes: Uint8Array) {
  const blob = new Blob([bytes]);
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => blob })));
  return blob;
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
const PDF_BYTES = new Uint8Array([...'%PDF-1.7\n1 0 obj'].map(c => c.charCodeAt(0)));
const GIF_BYTES = new Uint8Array([...'GIF89a'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
const JUNK_BYTES = new Uint8Array([...'not an image at all'].map(c => c.charCodeAt(0)));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('uploadQuotePhoto (web)', () => {
  it('uploads a normal compressed photo as image/jpeg under a .jpg path', async () => {
    manipulateMock.mockResolvedValue({ uri: 'blob:compressed' } as any);
    serveBlob(JPEG_BYTES);

    const url = await uploadQuotePhoto('user-1', 'blob:source');

    expect(uploadBytesMock).toHaveBeenCalledTimes(1);
    expect(uploadBytesMock.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg' });
    expect(refMock.mock.calls[0][1]).toMatch(/^users\/user-1\/quote-photos\/.+\.jpg$/);
    expect(url).toContain('quote-photos');
  });

  it('REGRESSION: a PDF that the canvas cannot decode uploads as application/pdf under a .pdf path', async () => {
    // compressImage's manipulateAsync throws for a PDF and falls back to the
    // original URI — the bytes reaching upload are the raw PDF.
    manipulateMock.mockRejectedValue(new Error('cannot decode'));
    serveBlob(PDF_BYTES);

    await uploadQuotePhoto('user-1', 'blob:plan-pdf');

    expect(uploadBytesMock).toHaveBeenCalledTimes(1);
    expect(uploadBytesMock.mock.calls[0][2]).toEqual({ contentType: 'application/pdf' });
    expect(refMock.mock.calls[0][1]).toMatch(/\.pdf$/);
  });

  it('rejects unsupported bytes (e.g. HEIC/junk) with UnsupportedPhotoError and uploads nothing', async () => {
    manipulateMock.mockRejectedValue(new Error('cannot decode'));
    serveBlob(JUNK_BYTES);

    await expect(uploadQuotePhoto('user-1', 'blob:mystery')).rejects.toBeInstanceOf(UnsupportedPhotoError);
    expect(uploadBytesMock).not.toHaveBeenCalled();
  });

  it('rejects GIFs (viewable, but the vision models cannot take them)', async () => {
    manipulateMock.mockRejectedValue(new Error('cannot decode'));
    serveBlob(GIF_BYTES);

    await expect(uploadQuotePhoto('user-1', 'blob:animated')).rejects.toBeInstanceOf(UnsupportedPhotoError);
    expect(uploadBytesMock).not.toHaveBeenCalled();
  });

  it('rejects a PDF over the pipeline cap with a size-specific message instead of uploading a plan the analyze would silently drop', async () => {
    manipulateMock.mockRejectedValue(new Error('cannot decode'));
    const huge = new Uint8Array(14_000_001);
    huge.set([...'%PDF-1.7\n'].map(c => c.charCodeAt(0)));
    serveBlob(huge);

    await expect(uploadQuotePhoto('user-1', 'blob:huge-plan')).rejects.toThrow(/too big/);
    expect(uploadBytesMock).not.toHaveBeenCalled();
  });

  it('uploads a PNG that survived the fallback with its true content type', async () => {
    manipulateMock.mockRejectedValue(new Error('cannot decode'));
    serveBlob(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]));

    await uploadQuotePhoto('user-1', 'blob:png-source');

    expect(uploadBytesMock.mock.calls[0][2]).toEqual({ contentType: 'image/png' });
    expect(refMock.mock.calls[0][1]).toMatch(/\.png$/);
  });
});

// Mate's chat compresses up front so the model and Storage share one set of
// bytes; a second pass inside uploadQuotePhoto would re-encode an already
// lossy JPEG and degrade the copy the vision model reads plan dimensions off.
describe('alreadyCompressed', () => {
  it('skips the compression pass when the caller has already run it', async () => {
    vi.mocked(manipulateAsync).mockClear();
    serveBlob(JPEG_BYTES);
    await uploadQuotePhoto('u1', 'file:///pre-compressed.jpg', { alreadyCompressed: true });
    expect(manipulateAsync).not.toHaveBeenCalled();
  });

  it('still compresses when the caller has not', async () => {
    vi.mocked(manipulateAsync).mockClear();
    serveBlob(JPEG_BYTES);
    await uploadQuotePhoto('u1', 'file:///raw.jpg');
    expect(manipulateAsync).toHaveBeenCalled();
  });
});
