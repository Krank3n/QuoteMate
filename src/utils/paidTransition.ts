/**
 * What "Mark as Paid" should actually do.
 *
 * `paid` is the one status living on both axes — the Job stage and the
 * Document's payment ledger — and they could disagree. Flipping the Job to
 * `paid` writes nothing to the invoice, so a tradie could end up with a job
 * reading Paid while the invoice still owes money, no payment in the ledger,
 * and no receipt sent. Their own records would say they'd been paid for work
 * they hadn't.
 *
 * So when money is genuinely outstanding, the tap becomes "record the
 * payment" instead of a stage flip. Recording it is what makes something
 * paid: the document reaches stage `paid`, and deriveJobStageBump
 * (functions/src/jobHandlers.ts) bumps the Job from the server. Both axes
 * agree without the client having to couple them.
 *
 * Where nothing is owed — a cash job with no invoice, a quote-only job, an
 * invoice already settled — the plain flip stands. Blocking that would break
 * a real and common case.
 */

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';

/** Amounts within half a cent are settled. Mirrors derivePaymentState. */
const EPSILON = 0.005;

export type PaidTransition =
  | { kind: 'record_payment'; invoiceId: string; balanceDue: number }
  | { kind: 'flip' };

/** Outstanding balance, computed rather than read from the stored
 *  `balanceDue` — that field can be stale on older docs, and
 *  RecordPaymentScreen derives it this way too. */
function balanceOwing(doc: Document): number {
  const total = Number(doc.total) || 0;
  const paid = Number(doc.paidTotal) || 0;
  return total - paid;
}

export function resolvePaidTransition(
  job: Pick<Job, 'stage'>,
  docs: Document[],
): PaidTransition {
  // `closed → paid` is the unarchive edge, not a payment moment — see the
  // comment on JOB_STAGE_TRANSITIONS.closed. Sending an unarchive to the
  // record-payment screen would be plainly wrong.
  if (job.stage === 'closed') return { kind: 'flip' };

  const owing = (docs || []).filter(
    (d) =>
      d &&
      d.type === 'invoice' &&
      d.stage !== 'cancelled' &&
      balanceOwing(d) > EPSILON,
  );
  if (owing.length === 0) return { kind: 'flip' };

  // Largest balance first — that's the money that matters. Ties break on id
  // so the same job always routes to the same invoice.
  const target = [...owing].sort((a, b) => {
    const diff = balanceOwing(b) - balanceOwing(a);
    if (Math.abs(diff) > EPSILON) return diff;
    return String(a.id).localeCompare(String(b.id));
  })[0];

  return {
    kind: 'record_payment',
    invoiceId: target.id,
    balanceDue: balanceOwing(target),
  };
}
