/**
 * LLM attachment normalization for the materials-analyze path.
 *
 * Photos reach analyzeJobDescription as bare base64 strings — client-supplied
 * (native local files) or fetched from Storage — and the bytes can't be
 * trusted to match their stored contentType: the web uploader historically
 * saved raw PDF bytes as "image/jpeg" (.jpg), which made BOTH providers
 * return 400 ("Could not process image") and killed the whole analyze run
 * for every photo on the quote.
 *
 * So each payload is identified from its magic bytes (via the base64 prefix,
 * nothing decoded) and sent with its true media type. PDFs are first-class —
 * commercial plans usually ARE PDFs; Claude takes them as `document` blocks,
 * Gemini inline. Anything neither provider decodes is dropped with a warning
 * instead of failing the request.
 */

export type LlmAttachmentMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';

export interface LlmAttachment {
  /** Bare base64 payload, no data: URI prefix. */
  data: string;
  mediaType: LlmAttachmentMediaType;
}

export interface DroppedAttachment {
  index: number;
  reason: string;
}

// Anthropic's 5MB-per-image limit counts the BASE64 payload (5,242,880
// encoded chars ≈ 3.9MB raw), so this raw ceiling keeps the fallback
// provider usable for every image that survives normalization.
export const MAX_IMAGE_ATTACHMENT_BYTES = 3_900_000;
// PDFs aren't bound by the per-image cap — Claude documents ride the 32MB
// request limit and Gemini's inline ceiling is ~20MB per request — so the
// per-file cap matches the whole-request budget below.
export const MAX_PDF_ATTACHMENT_BYTES = 14_000_000;
// Total raw budget across all attachments: ~19MB once base64-inflated, under
// Gemini's ~20MB inline request limit (Claude's is 32MB). Attachments beyond
// the budget are dropped so the request stays sendable instead of 400ing —
// the failure mode this module exists to prevent.
export const MAX_TOTAL_ATTACHMENT_BYTES = 14_000_000;

/**
 * Identify a payload from its base64 prefix (magic bytes, at most 12 bytes
 * decoded). Returns a supported media type, 'image/gif' (recognized but
 * rejected — the two providers don't BOTH accept it inline), or null for
 * unrecognized bytes.
 */
export function attachmentTypeFromBase64(base64: string): LlmAttachmentMediaType | 'image/gif' | null {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('UklGR')) {
    // RIFF container — WAV and AVI share this prefix, so decode enough to
    // check the format tag at bytes 8-11 before calling it WebP.
    const header = Buffer.from(base64.slice(0, 16), 'base64');
    return header.length >= 12 && header.subarray(8, 12).toString('latin1') === 'WEBP'
      ? 'image/webp'
      : null;
  }
  if (base64.startsWith('JVBERi0')) return 'application/pdf'; // "%PDF-"
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  return null;
}

/** Decoded byte length of a base64 string (close enough for a size cap). */
export function base64ByteLength(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Turn untrusted base64 payloads into provider-ready attachments. Strips any
 * data: URI prefix, types each payload from its bytes, and drops (never
 * throws on) anything unrecognized, unsupported, or oversized so one bad
 * file can't fail the whole analyze.
 */
export function normalizeLlmAttachments(base64List: string[]): {
  attachments: LlmAttachment[];
  dropped: DroppedAttachment[];
} {
  const attachments: LlmAttachment[] = [];
  const dropped: DroppedAttachment[] = [];
  let totalBytes = 0;

  base64List.forEach((raw, index) => {
    let data = typeof raw === 'string' ? raw : '';
    if (data.startsWith('data:')) {
      data = data.slice(data.indexOf(',') + 1);
    }
    if (!data) {
      dropped.push({ index, reason: 'empty payload' });
      return;
    }
    const type = attachmentTypeFromBase64(data);
    if (!type) {
      dropped.push({ index, reason: 'unrecognized bytes (not JPEG/PNG/WebP/PDF)' });
      return;
    }
    if (type === 'image/gif') {
      dropped.push({ index, reason: 'unsupported type image/gif' });
      return;
    }
    const bytes = base64ByteLength(data);
    const perFileCap = type === 'application/pdf' ? MAX_PDF_ATTACHMENT_BYTES : MAX_IMAGE_ATTACHMENT_BYTES;
    if (bytes > perFileCap) {
      dropped.push({ index, reason: `too large (${bytes} bytes > ${perFileCap} for ${type})` });
      return;
    }
    if (totalBytes + bytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      dropped.push({ index, reason: `total attachment budget exceeded (${totalBytes + bytes} bytes > ${MAX_TOTAL_ATTACHMENT_BYTES})` });
      return;
    }
    totalBytes += bytes;
    attachments.push({ data, mediaType: type });
  });

  return { attachments, dropped };
}
