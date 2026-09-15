/**
 * Photo cap, trim and upload-progress rules for the JobPhotos grid.
 *
 * Pure so they can be tested without rendering the component (which pulls in
 * the camera, the image picker and Storage). Every alert and counter in
 * JobPhotos derives from MAX_PHOTOS, so the copy follows when the cap moves.
 *
 * Mate's per-message chat limit is a separate rule and stays where it is
 * (src/screens/assistant/chatAttachments.ts).
 */

/** Photos (site photos and plans together) allowed on one quote. */
export const MAX_PHOTOS = 30;

/** Slots left before the cap, never negative. */
export function remainingPhotoSlots(currentCount: number, max: number = MAX_PHOTOS): number {
  return Math.max(0, max - currentCount);
}

/** Copy for the "you're at the cap" alert. */
export function photoLimitMessage(max: number = MAX_PHOTOS): string {
  return `Maximum ${max} photos per quote.`;
}

export interface TrimResult<T> {
  /** The items that fit under the cap, in the order they were picked. */
  kept: T[];
  /** How many were left out. */
  dropped: number;
  /** Alert copy when something was left out, otherwise null. */
  notice: string | null;
}

/**
 * Trim a freshly picked batch so the grid never exceeds the cap. The picker
 * runs with an unlimited selection (iOS only shows the multi-select UI that
 * way), so this is where the cap is enforced.
 */
export function trimToPhotoLimit<T>(
  picked: T[],
  currentCount: number,
  max: number = MAX_PHOTOS,
): TrimResult<T> {
  const slots = remainingPhotoSlots(currentCount, max);
  if (picked.length <= slots) {
    return { kept: picked, dropped: 0, notice: null };
  }
  const kept = picked.slice(0, slots);
  return {
    kept,
    dropped: picked.length - slots,
    notice: slots === 1
      ? `Only the first photo was added (max ${max} per quote).`
      : `Only the first ${slots} photos were added (max ${max} per quote).`,
  };
}

export interface UploadProgress {
  /** 1-based position of the photo currently uploading. */
  current: number;
  /** Photos in this batch. */
  total: number;
}

/**
 * "Uploading 4 of 12" while a batch is in flight. Uploads run one at a time,
 * so with 30 photos a phone can sit on this for a minute or two; the label is
 * what tells the tradie to wait rather than tap Add again. Null when nothing
 * is uploading or the batch is a single photo (the tile spinner covers that).
 */
export function uploadProgressLabel(progress: UploadProgress | null | undefined): string | null {
  if (!progress || progress.total <= 1) return null;
  const current = Math.min(Math.max(1, progress.current), progress.total);
  return `Uploading ${current} of ${progress.total}`;
}
