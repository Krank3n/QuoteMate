/**
 * The customer's own words from the acceptance page.
 *
 * The page asks "anything we should know?", the server stores the answer on
 * the quote as `clientNotes`, and the notification email prints it. The app
 * showed it nowhere at all — so a tradie who saw "Quote rejected" on the job
 * had the fact without the reason, and nothing to act on.
 *
 * Two readers, two shapes: the activity rail wants one elided line, the job
 * screen wants the whole thing under a heading. Both live here so the rule for
 * "is there a note?" is written once.
 */

import type { Document, DocumentStage } from '../types/document';

/** A timeline row is one line — past this the note is elided, not wrapped. */
const NOTE_DETAIL_MAX = 90;

/**
 * Cut a note down to a timeline detail. Long enough to carry a real answer
 * ("too dear, going with the other mob"), short enough that a pasted
 * paragraph can't take over the rail. Newlines collapse for the same reason.
 */
export function clientNoteDetail(note?: string): string | undefined {
  const text = (note ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length <= NOTE_DETAIL_MAX) return text;
  return text.slice(0, NOTE_DETAIL_MAX).trimEnd() + '…';
}

export interface CustomerNote {
  /** Section heading — names what the note IS, given how they answered. */
  label: string;
  /** The note itself, whitespace-trimmed but otherwise untouched. */
  text: string;
}

/**
 * The note as the job screen shows it: in full, under a heading that reads
 * right for the answer it came with. Null when there's nothing to show, so
 * the caller renders nothing rather than an empty card.
 */
export function customerResponseNote(
  doc: Pick<Document, 'clientNotes'> & { stage?: DocumentStage } | null | undefined,
): CustomerNote | null {
  const text = (doc?.clientNotes ?? '').trim();
  if (!text) return null;
  return {
    label: doc?.stage === 'quote_rejected' ? 'Why they said no' : 'What the customer said',
    text,
  };
}
