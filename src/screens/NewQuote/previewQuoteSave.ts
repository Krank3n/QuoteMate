/**
 * The quote payload JobPreview persists — used by both the auto-save on
 * mount and the notes re-save behind the Close button.
 *
 * Stamps `draftStep: 'JobPreview'` rather than clearing it: a draft
 * parked here is a FINISHED-BUT-UNSENT quote — the biggest stall bucket
 * in the Jul 2026 send audit — and the marker is what lets the
 * dashboard's draft banner ("Send it to your customer") and the
 * unsent_quote nudge find it. This save used to clear the marker, so
 * finished drafts were only detectable when a stale background save
 * happened to re-write it from the in-memory quote.
 *
 * Safe for non-drafts: saveQuote strips draftStep from any quote whose
 * status has moved past 'draft' (see useStore.saveQuote), so the stamp
 * can never stick to a sent/accepted quote.
 */
import type { Quote } from '../../types';

export function buildPreviewQuoteSave(
  quote: Quote,
  notes: string,
  refNumber?: string,
): Quote {
  return {
    ...quote,
    notes,
    draftStep: 'JobPreview',
    ...(refNumber ? { quoteNumber: refNumber } : {}),
    updatedAt: new Date(),
  };
}
