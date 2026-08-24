// Reading a chat attachment's bytes on demand.
//
// Nothing here is cached on the ChatMessage: base64 on a message would ride
// every scheduleConversationSync flush into Firestore. The bytes are pulled
// from the local uri at send time and thrown away again.

import { Platform } from 'react-native';
import { imageMimeFromBase64 } from '../../utils/imageMime';
import type { ChatAttachment } from '../../types/assistant';
import type { InlineBytes } from './attachmentParts';

// Lazy-import FileSystem — only available on native.
let FileSystem: typeof import('expo-file-system') | null = null;
if (Platform.OS !== 'web') {
  FileSystem = require('expo-file-system');
}

/**
 * Base64 for a local file / blob / data uri. Shared with the supplier-list
 * importer, which needs the same read for its extractor payload.
 */
export async function readBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    // Convert blob URL or data URL to base64 via fetch
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // strip "data:<mime>;base64," prefix if present
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  if (!FileSystem) throw new Error('FileSystem unavailable');
  return await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

/**
 * A uri the file readers can actually open. On native
 * FileSystem.readAsStringAsync cannot read https://, so a Storage-only
 * attachment is pulled into the cache first — that's the uri the supplier-list
 * importer needs when the original pick is long gone.
 */
export async function ensureLocalUri(a: ChatAttachment): Promise<string | null> {
  if (a.localUri) return a.localUri;
  if (!a.storageUrl) return null;
  if (Platform.OS === 'web' || !FileSystem) return a.storageUrl;
  try {
    const target = `${FileSystem.cacheDirectory}mate-attachment-${a.id}`;
    const info = await FileSystem.getInfoAsync(target);
    if (info.exists) return target;
    const res = await FileSystem.downloadAsync(a.storageUrl, target);
    return res.uri;
  } catch {
    return null;
  }
}

async function tryRead(uri: string | null | undefined): Promise<string | null> {
  if (!uri) return null;
  try {
    return await readBase64(uri);
  } catch {
    return null;
  }
}

/**
 * Bytes for one attachment, typed from its MAGIC NUMBERS rather than the
 * recorded mimeType — the picker's type is a hint, and a mislabelled PDF once
 * 400'd both vision providers. GIF is recognised and rejected here because the
 * server-side attachment builder drops it anyway.
 *
 * Returns null on any failure so one bad photo can't sink the whole turn.
 */
export async function resolveInlineBytes(a: ChatAttachment): Promise<InlineBytes | null> {
  let data = await tryRead(a.localUri);
  if (!data && a.storageUrl) {
    // The local file is gone (web blob: uri after a reload, cache eviction) —
    // fall back to the durable copy.
    data = await tryRead(await ensureLocalUri({ ...a, localUri: undefined }));
  }
  if (!data) return null;
  const mimeType = imageMimeFromBase64(data);
  if (!mimeType || mimeType === 'image/gif') return null;
  return { mimeType, data };
}
