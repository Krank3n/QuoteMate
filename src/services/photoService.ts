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

// Logo-specific compression — logos appear small on PDFs/emails so 512px is
// plenty. Keeps uploaded file size in the low-10s of KB range instead of
// multi-MB photos straight from the camera roll.
const LOGO_MAX_WIDTH = 512;
const LOGO_JPEG_QUALITY = 0.8;

/**
 * Compress and resize an image before saving
 */
export async function compressImage(uri: string): Promise<string> {
  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: MAX_WIDTH } }],
      { compress: JPEG_QUALITY, format: SaveFormat.JPEG }
    );
    return result.uri;
  } catch (error) {
    return uri;
  }
}

/**
 * Compress a logo for upload. Smaller target size than general quote photos
 * because logos render at ~100-200px on PDFs and emails — storing anything
 * larger wastes Firebase Storage and slows email rendering.
 */
export async function compressLogo(uri: string): Promise<string> {
  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: LOGO_MAX_WIDTH } }],
      { compress: LOGO_JPEG_QUALITY, format: SaveFormat.JPEG }
    );
    return result.uri;
  } catch (error) {
    return uri;
  }
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
 * Save a photo for use in a quote.
 * Compresses, uploads to Firebase Storage, and returns the public download URL.
 */
export async function uploadQuotePhoto(
  userId: string,
  photoUri: string
): Promise<string> {
  // Compress first (works on all platforms)
  const compressedUri = await compressImage(photoUri);

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
