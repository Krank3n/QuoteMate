/**
 * Photo Service - Manage job photos for quotes
 *
 * Compresses images and uploads to Firebase Storage, returning a public
 * download URL that works in emails and across devices.
 */

import { Platform } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { generateId } from '../utils/generateId';
import { trimLogoWhitespace } from '../utils/logoTrim';
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
  // Trim uniform whitespace margins first — a wordmark exported onto a big
  // square canvas would otherwise scale to fit *with* the empty margins and
  // print tiny no matter how the user resizes the file. Best-effort: on any
  // detection failure the untrimmed image carries on.
  const trimmedUri = await trimLogoWhitespace(uri);

  const isPng = mimeType === 'image/png' || /\.png(\?|$)/i.test(uri);

  if (isPng) {
    const result = await manipulateAsync(
      trimmedUri,
      [{ resize: { width: LOGO_MAX_WIDTH } }],
      { format: SaveFormat.PNG }
    );
    return { uri: result.uri, contentType: 'image/png', extension: 'png' };
  }

  const result = await manipulateAsync(
    trimmedUri,
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
  // Already a remote URL (previously uploaded, or a processed variant the
  // tradie picked), nothing to do.
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
 * Upload a logo and get back both variants for the tradie to choose between.
 *
 * Deliberately writes to a fresh path under logo-uploads/ rather than the
 * canonical users/<uid>/logo.png. The preview needs the file on the server
 * before the tradie has decided anything, and overwriting the canonical path
 * at that point would destroy the logo they are still using on every document
 * — even if they then backed out without saving.
 *
 * Falls back to just the uploaded URL when processing fails or the image was
 * already remote: a logo that defeats the analysis still has to work.
 */
export async function uploadAndProcessBusinessLogo(
  userId: string,
  uri: string,
  mimeType?: string,
): Promise<ProcessedLogoVariants> {
  return uploadAndProcessBrandImage(userId, 'logo-uploads', uri, mimeType);
}

/**
 * As above, for any brand image the tradie puts on a document — company logo,
 * accreditation badge, and whatever comes next. `folder` keeps them apart
 * under the user's own Storage path.
 */
export async function uploadAndProcessBrandImage(
  userId: string,
  folder: string,
  uri: string,
  mimeType?: string,
): Promise<ProcessedLogoVariants> {
  if (uri.startsWith('https://')) {
    return { originalUrl: uri, background: 'transparent', recommendNoBackground: false };
  }

  const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '') || 'brand-uploads';
  const { uri: compressedUri, contentType, extension } = await compressLogo(uri, mimeType);
  const blob = await uriToBlob(compressedUri);
  const sourcePath = `users/${userId}/${safeFolder}/${generateId()}.${extension}`;
  await uploadBytes(ref(storage, sourcePath), blob, { contentType });
  const url = await getDownloadURL(ref(storage, sourcePath));

  const processed = await processUploadedLogo(sourcePath);
  return processed ?? { originalUrl: url, background: 'transparent', recommendNoBackground: false };
}

export interface ProcessedLogoVariants {
  originalUrl: string;
  noBackgroundUrl?: string;
  background: 'transparent' | 'light' | 'dark' | 'busy';
  recommendNoBackground: boolean;
  /** Why no variant, when there is none — see functions/src/logoProcessing. */
  noBackgroundReason?: 'transparent' | 'busy' | 'ragged';
}

/**
 * Ask the server to tidy a just-uploaded logo and hand back both variants.
 *
 * Background removal can't happen on-device — expo-image-manipulator resizes
 * and crops but cannot write pixels. Returns null on any failure: a logo we
 * can't process must still be usable as uploaded, never a blocked save.
 */
/** users/<uid>/logo.png from a Firebase Storage download URL, or null. */
export function storagePathFromDownloadUrl(url: string): string | null {
  if (!url?.startsWith('https://firebasestorage.googleapis.com/')) return null;
  const match = url.match(/\/o\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function processUploadedLogo(
  sourcePath: string,
): Promise<ProcessedLogoVariants | null> {
  try {
    const callable = httpsCallable<{ sourcePath: string }, ProcessedLogoVariants>(
      getFunctions(),
      'processBusinessLogo',
    );
    const { data } = await callable({ sourcePath });
    return data ?? null;
  } catch (error) {
    console.warn('[photoService] logo processing failed, keeping the upload as-is', error);
    return null;
  }
}

/** Upload one customer-facing licence/accreditation badge. Kept separate from
 * the company logo so a business can carry several credentials at once. */
export async function uploadBusinessCredentialLogo(
  userId: string,
  credentialId: string,
  uri: string,
  mimeType?: string,
): Promise<string> {
  if (uri.startsWith('https://')) return uri;

  const safeId = credentialId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid credential id');
  const { uri: compressedUri, contentType, extension } = await compressLogo(uri, mimeType);
  const blob = await uriToBlob(compressedUri);
  const badgeRef = ref(storage, `users/${userId}/credential-logos/${safeId}.${extension}`);
  await uploadBytes(badgeRef, blob, { contentType });
  const url = await getDownloadURL(badgeRef);

  const otherExtension = extension === 'png' ? 'jpg' : 'png';
  try {
    await deleteObject(ref(storage, `users/${userId}/credential-logos/${safeId}.${otherExtension}`));
  } catch {
    // No previous badge in the other format.
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
