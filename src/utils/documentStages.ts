/**
 * Lifecycle questions asked of a Document's stage, in one place.
 *
 * The dashboard tiles and every Insights chart used to ask these of the legacy
 * `quotes` collection instead — `status === 'accepted' || 'completed'`. That
 * reads 0 until the legacy mirror catches up on a fresh sign-in, and it goes
 * stale for good once a quote is converted, because the legacy status leaves
 * accepted/completed and the job you won stops counting as won.
 *
 * Stage sets are explicit rather than a stageRank comparison because
 * `cancelled` deliberately ranks ABOVE `paid` (see shared/document/stage.ts),
 * so "rank >= quote_accepted" would quietly count cancelled work as won.
 */

import type { Document, DocumentStage } from '../types/document';

/** Sent, still waiting on the customer. Rejection is an answer, so it's out. */
const AWAITING: ReadonlySet<DocumentStage> = new Set(['quote_sent']);

/**
 * Accepted or anything past it. An invoiced, part-paid or fully paid job is
 * still a job you won — that's the drift the legacy status couldn't express.
 */
const WON: ReadonlySet<DocumentStage> = new Set([
  'quote_accepted',
  'invoice_sent',
  'partially_paid',
  'paid',
]);

export function isAwaitingResponse(stage: DocumentStage): boolean {
  return AWAITING.has(stage);
}

export function isWon(stage: DocumentStage): boolean {
  return WON.has(stage);
}

/**
 * When a job was won, for attributing it to a month. `acceptedAt` is stamped
 * on the first move to quote_accepted; older documents predate that field, so
 * fall back to updatedAt — which is what the legacy charts keyed on anyway.
 */
export function wonAt(doc: Document): number {
  return Number(doc?.acceptedAt) || Number(doc?.updatedAt) || 0;
}

/** Cancelled work shouldn't pad a funnel's denominator. */
export function countsInPipeline(doc: Document): boolean {
  return !!doc && doc.stage !== 'cancelled';
}
