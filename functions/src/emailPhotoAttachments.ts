/**
 * Which of a quote's photos ride on the customer email as files, and in what
 * order. A quote can carry up to 30 photos; a 30-attachment email is not what
 * a customer wants and Brevo rejects the whole send around 10 MB, so the send
 * is capped by count first (plans before site photos) and then by bytes.
 *
 * Pure so the selection and the budget can be tested without fetching. The
 * caller (fetchPhotoAttachments in index.ts) fetches only what
 * selectEmailPhotoUrls returns.
 */
import { isPdfUrl } from './shared/media/pdfUrl';

/** Files attached to one quote email, plans and photos together. */
export const MAX_EMAIL_PHOTO_ATTACHMENTS = 10;

/**
 * Second guard behind the count cap. Brevo rejects the whole send around
 * 10 MB of attachments, and a quote that arrives without one photo beats a
 * quote that never arrives.
 */
export const MAX_EMAIL_ATTACHMENT_BYTES = 7_000_000;

/**
 * The URLs worth fetching: remote only (legacy quotes carry local file://
 * URIs), plans first so the 7 MB budget never silently drops a plan behind a
 * run of site photos, then site photos in the order the tradie added them,
 * capped at the attachment count.
 */
export function selectEmailPhotoUrls(
  photoUrls: string[],
  max: number = MAX_EMAIL_PHOTO_ATTACHMENTS,
): string[] {
  const remote = (photoUrls || []).filter(url => typeof url === 'string' && /^https?:\/\//i.test(url));
  const plans = remote.filter(url => isPdfUrl(url));
  const photos = remote.filter(url => !isPdfUrl(url));
  return [...plans, ...photos].slice(0, max);
}

export interface FetchedPhotoFile {
  /** From the response content-type; a plan stored under a .jpg name still counts. */
  isPdf: boolean;
  ext: string;
  bytes: number;
  /** Base64 file body. */
  content: string;
}

export interface EmailAttachment {
  name: string;
  content: string;
}

/**
 * Name and order the fetched files: plans first (Plan_1.pdf, ...), then site
 * photos (Job_Photo_1.jpg, ...), stopping at the count cap and skipping any
 * file that would push the total over the byte budget.
 */
export function buildEmailPhotoAttachments(
  files: FetchedPhotoFile[],
  opts: { maxFiles?: number; maxBytes?: number } = {},
): EmailAttachment[] {
  const maxFiles = opts.maxFiles ?? MAX_EMAIL_PHOTO_ATTACHMENTS;
  const maxBytes = opts.maxBytes ?? MAX_EMAIL_ATTACHMENT_BYTES;
  const ordered = [...files.filter(f => f.isPdf), ...files.filter(f => !f.isPdf)];

  const attachments: EmailAttachment[] = [];
  let photoCount = 0;
  let planCount = 0;
  let totalBytes = 0;
  for (const file of ordered) {
    if (attachments.length >= maxFiles) {
      console.warn('[email attachments] skipping attachment over email file cap', {
        maxFiles,
        isPdf: file.isPdf,
      });
      continue;
    }
    if (totalBytes + file.bytes > maxBytes) {
      console.warn('[email attachments] skipping attachment over email budget', {
        bytes: file.bytes,
        totalBytes,
      });
      continue;
    }
    totalBytes += file.bytes;
    attachments.push({
      name: file.isPdf ? `Plan_${++planCount}.pdf` : `Job_Photo_${++photoCount}.${file.ext}`,
      content: file.content,
    });
  }
  return attachments;
}
