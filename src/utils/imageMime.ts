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
