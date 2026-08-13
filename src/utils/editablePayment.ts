/**
 * Which recorded payments a tradie may correct after the fact.
 *
 * Manual entries are typed by a human and will sometimes be wrong — the wrong
 * amount, the wrong day, the wrong method. Those should be fixable in place
 * rather than requiring a compensating second entry that makes the history
 * read like a puzzle.
 *
 * A Square-sourced payment is different: it mirrors a real transaction that
 * exists in Square's records and in the customer's bank. Editing it locally
 * would make the two silently disagree, and QuoteMate would be the one
 * lying. Those stay read-only; a refund belongs in Square.
 */

import type { DocumentPayment } from '../types/document';

export function isEditablePayment(payment?: DocumentPayment | null): boolean {
  if (!payment) return false;
  // `squarePaymentId` is the ONLY reliable signal that money moved through
  // Square. Deliberately not `method === 'square'`: the legacy projection
  // maps a hand-typed CARD payment to that method
  // (shared/document/adapter.ts:280), so keying off it locked tradies out of
  // correcting payments they had entered themselves — including a real
  // overpaid invoice found in production (INV-006, `manual/square`, no
  // transaction id).
  return !payment.squarePaymentId;
}

/**
 * The most this payment may be raised to without overpaying the invoice.
 *
 * The append-time guard (`total − paidTotal`) is wrong when editing, because
 * `paidTotal` already includes the payment being edited — it would cap an
 * unchanged payment at zero. Exclude it from the balance first.
 */
export function maxAmountForEdit(
  doc: { total?: unknown; paidTotal?: unknown },
  payment: Pick<DocumentPayment, 'amount'>,
): number {
  const total = Number(doc.total) || 0;
  const paid = Number(doc.paidTotal) || 0;
  const others = paid - (Number(payment.amount) || 0);
  return Math.max(0, total - Math.max(0, others));
}
