/**
 * State machine for the unified Document.stage field.
 *
 * Phase 2 will wire canTransition into save paths so that an illegal
 * transition (e.g. paid → draft) is rejected at write time. For now this
 * lives standalone so the rules can be reviewed in one place and unit-
 * tested without dragging in the store.
 *
 * Legal transitions (from → [to, ...]):
 *
 *   draft               → quote_sent | invoice_sent | cancelled
 *   quote_sent          → quote_accepted | quote_rejected | cancelled | draft
 *   quote_accepted      → invoice_sent | cancelled
 *   quote_rejected      → quote_sent | cancelled            (re-pitch path)
 *   invoice_sent        → partially_paid | paid | cancelled
 *   partially_paid      → paid | cancelled
 *   paid                → (terminal — only `cancelled` to support refunds)
 *   cancelled           → (terminal)
 *
 * Self-transitions are always allowed — saving an unchanged stage is a no-op,
 * not an error.
 */

import type { DocumentStage } from '../types/document';

export const LEGAL_TRANSITIONS: Readonly<Record<DocumentStage, ReadonlyArray<DocumentStage>>> = {
  draft: ['quote_sent', 'invoice_sent', 'cancelled'],
  quote_sent: ['quote_accepted', 'quote_rejected', 'cancelled', 'draft'],
  quote_accepted: ['invoice_sent', 'cancelled'],
  quote_rejected: ['quote_sent', 'cancelled'],
  invoice_sent: ['partially_paid', 'paid', 'cancelled'],
  partially_paid: ['paid', 'cancelled'],
  paid: ['cancelled'],
  cancelled: [],
};

export function canTransition(from: DocumentStage, to: DocumentStage): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * List the stages a document can move to from its current state. Useful for
 * driving status-picker UIs in phase 2 — they can offer only the moves that
 * the state machine allows rather than the full enum.
 */
export function allowedNextStages(from: DocumentStage): ReadonlyArray<DocumentStage> {
  return LEGAL_TRANSITIONS[from] ?? [];
}

/**
 * True when the stage is terminal — no transitions out except (for paid)
 * the cancellation/refund escape hatch.
 */
export function isTerminal(stage: DocumentStage): boolean {
  return LEGAL_TRANSITIONS[stage].length === 0;
}
