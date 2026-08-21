/**
 * Identify an image from its leading bytes, via the base64 prefix so nothing
 * has to be decoded.
 *
 * Lives in its own module so it stays importable without pulling in
 * expo-file-system (pdfGenerator's import graph installs native modules at
 * load time, which can't run under vitest).
 *
 * This is the guard that stops a non-image being embedded as one. PDFs inline
 * their images as base64 data URIs, and FileSystem.downloadAsync does NOT
 * throw on an HTTP error — it writes the response BODY to the file and
 * resolves. A 404 from Firebase Storage therefore got base64-encoded and
 * embedded as `data:image/png;base64,<the 404 JSON>`, which every print
 * renderer draws as a broken-image icon.
 */
export function imageMimeFromBase64(base64: string): string | null {
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return null;
}

/**
 * Byte-level twin of imageMimeFromBase64 for when raw bytes (a Blob header)
 * are cheaper than base64 — plus PDF, which the quote-photo pipeline accepts
 * as a plan document. This is the guard that stops the web uploader storing
 * arbitrary bytes as "image/jpeg": the file input's accept="image/*" is only
 * a hint, and a mislabelled PDF in Storage once 400'd both vision providers.
 */
export function attachmentMimeFromBytes(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 4 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 4 && ascii(0, 4) === 'GIF8') return 'image/gif';
  if (bytes.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

// Re-exported so app code keeps one import site for media sniffing; the
// implementation is shared with the functions-side email/PDF renderers.
export { isPdfUrl } from '../../shared/media/pdfUrl';
