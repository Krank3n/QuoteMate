/**
 * Forward-only STATUS guard for legacy saves.
 *
 * The app still writes the legacy `quotes` / `invoices` rows, and it writes
 * them from whatever copy of the record a screen happens to hold. That copy
 * can predate a stage move the server has since made: the preview screen's
 * `currentQuote` still says 'draft' twenty seconds after the email send
 * stamped 'sent', because the realtime listener refreshes the list and never
 * the current quote. The next save from that screen (leaving with edited
 * notes, a display toggle, a date change) put 'draft' straight back on the
 * legacy row. The mirror's forward-only stage guard protected the unified row,
 * so the two disagreed: on 16 Sep 2026, 60 of 208 sent quotes read 'draft' on
 * the legacy side — invisible to anything keyed on that status, including the
 * customer follow-up scheduler until it was moved onto the unified stage.
 *
 * This is the client-side twin of that mirror guard, applied at the store's
 * write chokepoint: a legacy save may carry any status EXCEPT one that would
 * rewind the unified row's stage. A deliberate rewind (Undo "marked sent",
 * the stage sheet's "back to draft") declares itself with `stageChange` and
 * passes through untouched. Pure.
 */
import { deriveStage, stageToInvoiceStatus, stageToQuoteStatus } from './adapter';
import { isStageDowngrade } from './stage';
import type { DocumentStage, DocumentType, LegacyDocumentRecord } from './types';

export interface HoldStatusOptions {
  /**
   * The caller is moving the stage on purpose (applyStageChange). Without
   * this, every deliberate sent→draft rewind would be silently undone.
   */
  stageChange?: boolean;
}

/**
 * The status this legacy save may carry. Returns the incoming status
 * unchanged unless it maps to a stage BELOW the unified row's, in which case
 * the unified stage's own legacy status is returned instead.
 *
 * `record` is the legacy quote or invoice about to be written; for invoices
 * the paid fields ride along so a stale 'sent' on a partly paid invoice is
 * read as the downgrade it is.
 */
export function holdStatusForward(
  record: LegacyDocumentRecord,
  unifiedStage: DocumentStage | null | undefined,
  type: DocumentType,
  options: HoldStatusOptions = {},
): string | undefined {
  const incoming = record.status as string | undefined;
  if (options.stageChange || !unifiedStage) return incoming;
  const incomingStage = deriveStage(record, type);
  if (!isStageDowngrade(unifiedStage, incomingStage)) return incoming;
  return type === 'invoice' ? stageToInvoiceStatus(unifiedStage) : stageToQuoteStatus(unifiedStage);
}
