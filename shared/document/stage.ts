/**
 * State machine for the unified Document.stage field.
 *
 * Legal transitions (from → [to, ...]):
 *
 *   draft               → quote_sent | invoice_sent | quote_accepted | cancelled
 *   quote_sent          → quote_accepted | quote_rejected | paid | cancelled | draft
 *   quote_accepted      → draft | invoice_sent | cancelled
 *   quote_rejected      → quote_sent | quote_accepted | cancelled   (re-pitch path)
 *   invoice_sent        → partially_paid | paid | cancelled
 *   partially_paid      → paid | cancelled
 *   paid                → cancelled
 *   cancelled           → draft                                     (un-cancel)
 *
 * Extra edges landed with Phase 11 to cover fast-paying customers:
 *   - draft → quote_accepted: customer paid a deposit on the first draft.
 *   - quote_rejected → quote_accepted: un-reject without re-pitching.
 *   - quote_sent → paid: customer paid the full quote amount directly.
 *
 * Mistake-recovery edges:
 *   - cancelled → draft: a cancelled doc drops back to draft so the tradie
 *     can rework the figures and re-send. They can move forward from there
 *     via the normal forward transitions.
 *   - quote_accepted → draft: convert-to-invoice flips type='invoice' but
 *     leaves the doc unsent (stage stays 'draft' until the tradie hits
 *     "Send Invoice", which moves it to invoice_sent). Without this edge
 *     the convert path was force-stamping invoice_sent on docs that had
 *     never gone out — surprising customers with "sent" history.
 *
 * Self-transitions are always allowed — saving an unchanged stage is a no-op.
 */

import type { DocumentStage } from './types';

export const LEGAL_TRANSITIONS: Readonly<Record<DocumentStage, ReadonlyArray<DocumentStage>>> = {
  draft: ['quote_sent', 'invoice_sent', 'quote_accepted', 'cancelled'],
  quote_sent: ['quote_accepted', 'quote_rejected', 'paid', 'cancelled', 'draft'],
  quote_accepted: ['draft', 'invoice_sent', 'cancelled'],
  quote_rejected: ['quote_sent', 'quote_accepted', 'cancelled'],
  invoice_sent: ['partially_paid', 'paid', 'cancelled'],
  partially_paid: ['paid', 'cancelled'],
  paid: ['cancelled'],
  cancelled: ['draft'],
};

export function canTransition(from: DocumentStage, to: DocumentStage): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextStages(from: DocumentStage): ReadonlyArray<DocumentStage> {
  return LEGAL_TRANSITIONS[from] ?? [];
}

export function isTerminal(stage: DocumentStage): boolean {
  return LEGAL_TRANSITIONS[stage].length === 0;
}

/**
 * Rough lifecycle ordering for forward-only checks. Used by the legacy→unified
 * mirror to avoid downgrading a stage that's already advanced past what the
 * legacy `status` field can express (e.g. a sent quote whose mobile client
 * later writes back status='draft' from a stale cache).
 *
 * cancelled is ranked above paid so the mirror never silently un-cancels a
 * doc — un-cancel goes through setDocumentStage explicitly. quote_rejected
 * sits alongside quote_sent because rejection is a sent-tier outcome.
 */
const STAGE_RANK: Readonly<Record<DocumentStage, number>> = {
  draft: 0,
  quote_sent: 10,
  quote_rejected: 10,
  quote_accepted: 20,
  invoice_sent: 30,
  partially_paid: 40,
  paid: 50,
  cancelled: 60,
};

export function stageRank(stage: DocumentStage): number {
  return STAGE_RANK[stage] ?? 0;
}

export function isStageDowngrade(from: DocumentStage, to: DocumentStage): boolean {
  return stageRank(to) < stageRank(from);
}
