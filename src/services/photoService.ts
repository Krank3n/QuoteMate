/**
 * Photo Service - Manage job photos for quotes
 *
 * Compresses images and uploads to Firebase Storage, returning a public
 * download URL that works in emails and across devices.
 */

import { Platform } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { generateId } from '../utils/generateId';
import { storage } from '../config/firebase';

const MAX_WIDTH = 1200;
const JPEG_QUALITY = 0.7;

// Plans / scaled drawings carry fine dimension text and finish codes that are
// unreadable once downscaled to 1200px. Send them larger and at higher quality
// so the vision model can actually read the scale and numbers. Larger upload +
// slightly higher vision cost, but materially better extraction accuracy.
export const PLAN_MAX_WIDTH = 2400;
export const PLAN_JPEG_QUALITY = 0.85;

// Logo-specific compression — logos appear small on PDFs/emails so 512px is
// plenty. Keeps uploaded file size in the low-10s of KB range instead of
// multi-MB photos straight from the camera roll.
const LOGO_MAX_WIDTH = 512;
const LOGO_JPEG_QUALITY = 0.8;

export interface CompressOptions {
  /** Compress a plan/drawing at higher resolution so fine text stays legible. */
  isPlan?: boolean;
}

/**
 * Compress and resize an image before saving. Pass `{ isPlan: true }` for
 * architectural plans/drawings to keep more detail (PLAN_MAX_WIDTH / quality).
 */
export async function compressImage(
  uri: string,
  opts: CompressOptions = {}
): Promise<string> {
  const width = opts.isPlan ? PLAN_MAX_WIDTH : MAX_WIDTH;
  const quality = opts.isPlan ? PLAN_JPEG_QUALITY : JPEG_QUALITY;
  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width } }],
      { compress: quality, format: SaveFormat.JPEG }
    );
    return result.uri;
  } catch (error) {
    return uri;
  }
}

export interface CompressedLogo {
  uri: string;
  contentType: string;
  extension: 'png' | 'jpg';
}

/**
 * Compress a logo for upload. Smaller target size than general quote photos
 * because logos render at ~100-200px on PDFs and emails.
 *
 * Preserves PNG so transparent logos keep their alpha channel; converts
 * everything else — HEIC, JPEG, WebP — to JPEG. Throws on failure: silently
 * falling back to the source bytes mislabelled as JPEG produces a "broken
 * image" file in Storage that nothing can render.
 */
export async function compressLogo(
  uri: string,
  mimeType?: string
): Promise<CompressedLogo> {
  const isPng = mimeType === 'image/png' || /\.png(\?|$)/i.test(uri);

  if (isPng) {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: LOGO_MAX_WIDTH } }],
      { format: SaveFormat.PNG }
    );
    return { uri: result.uri, contentType: 'image/png', extension: 'png' };
  }

  const result = await manipulateAsync(
    uri,
    [{ resize: { width: LOGO_MAX_WIDTH } }],
    { compress: LOGO_JPEG_QUALITY, format: SaveFormat.JPEG }
  );
  return { uri: result.uri, contentType: 'image/jpeg', extension: 'jpg' };
}

/**
 * Convert a local URI to a Blob for uploading.
 * On native, fetch(file://).blob() is unreliable — use XHR per Firebase's
 * official RN guidance. On web, fetch works fine.
 */
async function uriToBlob(uri: string): Promise<Blob> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return response.blob();
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('Failed to read image file'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

/**
 * Upload a business logo for the given user. Compresses, uploads to
 * Firebase Storage, removes any prior logo in the other format (so PNG→JPEG
 * or JPEG→PNG swaps don't leave orphans), and returns the public download URL.
 *
 * Throws on failure.
 */
export async function uploadBusinessLogo(
  userId: string,
  uri: string,
  mimeType?: string
): Promise<string> {
  // Already a remote URL (previously uploaded), nothing to do.
  if (uri.startsWith('https://')) return uri;

  const { uri: compressedUri, contentType, extension } = await compressLogo(uri, mimeType);
  const blob = await uriToBlob(compressedUri);

  const logoRef = ref(storage, `users/${userId}/logo.${extension}`);
  await uploadBytes(logoRef, blob, { contentType });
  const url = await getDownloadURL(logoRef);

  // Best-effort: drop the other format if a previous upload left one behind.
  const otherExtension = extension === 'png' ? 'jpg' : 'png';
  try {
    await deleteObject(ref(storage, `users/${userId}/logo.${otherExtension}`));
  } catch {
    // No prior logo in the other format — nothing to clean up.
  }

  return url;
}

/**
 * Save a photo for use in a quote.
 * Compresses, uploads to Firebase Storage, and returns the public download URL.
 */
export async function uploadQuotePhoto(
  userId: string,
  photoUri: string,
  opts: CompressOptions = {}
): Promise<string> {
  // Compress first (works on all platforms). Plans go through at higher res.
  const compressedUri = await compressImage(photoUri, opts);

  const blob = await uriToBlob(compressedUri);
  const photoId = generateId();
  const storageRef = ref(storage, `users/${userId}/quote-photos/${photoId}.jpg`);
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(storageRef);
}

/**
 * Delete a stored photo from Firebase Storage.
 * Accepts both full download URLs and storage paths.
 */
export async function deleteQuotePhoto(photoUri: string): Promise<void> {
  try {
    // Extract the storage path from a download URL or use as-is if already a path
    if (/^https?:\/\//i.test(photoUri)) {
      // Download URLs contain the path encoded in the URL
      const match = photoUri.match(/\/o\/(.+?)\?/);
      if (match) {
        const path = decodeURIComponent(match[1]);
        const storageRef = ref(storage, path);
        await deleteObject(storageRef);
      }
    } else if (photoUri.startsWith('blob:')) {
      // Legacy blob URL — just revoke
      try { URL.revokeObjectURL(photoUri); } catch { /* ignore */ }
    }
    // Legacy local file paths — nothing to clean up server-side
  } catch (error) {
    // Non-critical — photo may have already been deleted
  }
}
