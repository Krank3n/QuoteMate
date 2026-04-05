/**
 * Photo Service - Manage job photos for quotes
 *
 * Native: Compresses and copies to persistent documentDirectory
 * Web: Compresses and returns a blob URL (persists for session)
 */

import { Platform } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { generateId } from '../utils/generateId';

const MAX_WIDTH = 1200;
const JPEG_QUALITY = 0.7;

// Lazy-import FileSystem only on native (it's a no-op on web)
let FileSystem: typeof import('expo-file-system') | null = null;
if (Platform.OS !== 'web') {
  FileSystem = require('expo-file-system');
}

const PHOTOS_DIR = FileSystem
  ? `${FileSystem.documentDirectory}quote-photos/`
  : '';

/**
 * Ensure the photos directory exists (native only)
 */
async function ensurePhotosDir(): Promise<void> {
  if (!FileSystem) return;
  const info = await FileSystem.getInfoAsync(PHOTOS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  }
}

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
 * Save a photo for use in a quote
 *
 * Native: compresses + copies to persistent document directory, returns file URI
 * Web: compresses + creates a blob URL, returns blob URL
 */
export async function uploadQuotePhoto(
  userId: string,
  photoUri: string
): Promise<string> {
  // Compress first (works on all platforms)
  const compressedUri = await compressImage(photoUri);

  if (Platform.OS === 'web') {
    // On web, convert the manipulated image to a blob URL for display
    const response = await fetch(compressedUri);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  // Native: copy to persistent storage
  await ensurePhotosDir();
  const photoId = generateId();
  const destUri = `${PHOTOS_DIR}${photoId}.jpg`;
  await FileSystem!.copyAsync({ from: compressedUri, to: destUri });
  return destUri;
}

/**
 * Delete a stored photo
 */
export async function deleteQuotePhoto(photoUri: string): Promise<void> {
  if (Platform.OS === 'web') {
    // Revoke blob URL to free memory
    try {
      URL.revokeObjectURL(photoUri);
    } catch { /* ignore */ }
    return;
  }

  try {
    const info = await FileSystem!.getInfoAsync(photoUri);
    if (info.exists) {
      await FileSystem!.deleteAsync(photoUri, { idempotent: true });
    }
  } catch (error) {
  }
}
