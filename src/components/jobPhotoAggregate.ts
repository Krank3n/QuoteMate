/**
 * Which photos the job screen shows, and which of them it may change.
 *
 * A job's photos come from two places: `job.photos` (added from the job
 * screen, or migrated at backfill) and every attached document's `photos`
 * (added in the quote wizard). The strip shows both, but only job-owned
 * photos can be annotated or removed there — a customer has already seen the
 * sent quote, so a document's photos never change from the job screen.
 *
 * Pure so the ordering, de-duplication and ownership rules are testable
 * without rendering the strip.
 */

import type { JobPhoto } from '../../shared/job/types';
import type { Document } from '../types/document';
import { isPdfUrl } from '../utils/imageMime';

/** A job photo the strip may still be uploading (mirrors LocalPhoto). */
export interface StripPhoto extends JobPhoto {
  localUri?: string;
  uploading?: boolean;
  localIsPdf?: boolean;
  isPlan?: boolean;
}

export type PhotoOwner =
  | { kind: 'job' }
  | { kind: 'document'; documentId: string; label: string };

export interface AggregatedPhoto {
  photo: StripPhoto;
  owner: PhotoOwner;
}

/** Caption for a document-owned photo in the lightbox: "From QU-1042". */
export function documentPhotoLabel(doc: Pick<Document, 'number' | 'type'>): string {
  if (doc.number) return `From ${doc.number}`;
  return doc.type === 'invoice' ? 'From the invoice' : 'From the quote';
}

/**
 * Job's own photos first (including any still uploading), then every attached
 * document's photos, de-duplicated by id (falling back to storageUrl). PDFs
 * stay in the list — they get a document tile and open externally.
 */
export function aggregatePhotos(jobPhotos: StripPhoto[], documents: Document[]): AggregatedPhoto[] {
  const seen = new Set<string>();
  const out: AggregatedPhoto[] = [];

  const push = (p: StripPhoto | undefined | null, owner: PhotoOwner) => {
    if (!p) return;
    const key = p.id || p.storageUrl;
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (p.storageUrl || p.localUri) out.push({ photo: p, owner });
  };

  for (const p of jobPhotos) push(p, { kind: 'job' });
  for (const doc of documents) {
    const owner: PhotoOwner = { kind: 'document', documentId: doc.id, label: documentPhotoLabel(doc) };
    // QuotePhoto on the Document type matches JobPhoto structurally.
    for (const p of (doc.photos as StripPhoto[] | undefined) || []) push(p, owner);
  }
  return out;
}

/**
 * The subset the lightbox pages through: renderable, finished uploads. PDF
 * plans open in the browser instead (they would be blank frames), and a
 * pending upload has nothing at its storageUrl yet.
 */
export function lightboxPhotos(aggregated: AggregatedPhoto[]): AggregatedPhoto[] {
  return aggregated.filter(a => !a.photo.uploading && !!a.photo.storageUrl && !isPdfUrl(a.photo.storageUrl));
}

/** Only job-owned photos may be annotated or removed from the job screen. */
export function canEditPhoto(entry: AggregatedPhoto): boolean {
  return entry.owner.kind === 'job';
}

/** How many photos live on documents rather than the job (counted against the cap). */
export function documentOwnedCount(aggregated: AggregatedPhoto[]): number {
  return aggregated.filter(a => a.owner.kind === 'document').length;
}
