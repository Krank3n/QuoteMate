/**
 * State machine for the unified Document.stage field.
 *
 * Legal transitions (from → [to, ...]):
 *
 *   draft               → quote_sent | invoice_sent | quote_accepted | cancelled
 *   quote_sent          → quote_accepted | quote_rejected | paid | cancelled | draft
 *   quote_accepted      → invoice_sent | cancelled
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
 * Mistake-recovery edge:
 *   - cancelled → draft: a cancelled doc drops back to draft so the tradie
 *     can rework the figures and re-send. They can move forward from there
 *     via the normal forward transitions.
 *
 * Self-transitions are always allowed — saving an unchanged stage is a no-op.
 */

import type { DocumentStage } from './types';

export const LEGAL_TRANSITIONS: Readonly<Record<DocumentStage, ReadonlyArray<DocumentStage>>> = {
  draft: ['quote_sent', 'invoice_sent', 'quote_accepted', 'cancelled'],
  quote_sent: ['quote_accepted', 'quote_rejected', 'paid', 'cancelled', 'draft'],
  quote_accepted: ['invoice_sent', 'cancelled'],
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
