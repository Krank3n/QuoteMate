/**
 * State machine for the unified Document.stage field.
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
 * Self-transitions are always allowed — saving an unchanged stage is a no-op.
 */

import type { DocumentStage } from './types';

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

export function allowedNextStages(from: DocumentStage): ReadonlyArray<DocumentStage> {
  return LEGAL_TRANSITIONS[from] ?? [];
}

export function isTerminal(stage: DocumentStage): boolean {
  return LEGAL_TRANSITIONS[stage].length === 0;
}
