import type { Job, JobDocument } from './types';

export interface JobAggregates {
  totalQuoted: number;    // the representative quote's total — NOT a sum, see below
  totalInvoiced: number;  // Σ doc.total where doc.type === 'invoice'
  totalPaid: number;      // Σ doc.paidTotal across all attached docs
  balanceDue: number;     // Σ doc.balanceDue across the invoices + that one quote
  documentIds: string[];  // sorted ids of attached docs
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Which quote speaks for the job when it carries more than one.
 *
 * Several quotes on a job are competing OPTIONS — "either a multi-head system,
 * or two independent splits" — not parts of the work (see
 * shared/document/quoteOptions.ts). Only one of them will ever be accepted, so
 * adding them together states a price the customer was never offered: two
 * options at $6,675 and $6,116 would show the job as worth $12,791.
 *
 * That is the same mistake sections made inside a single quote, one level up,
 * and it reaches further — this figure feeds the job card, the job header and
 * the dashboard tiles.
 *
 * An accepted quote wins outright: once the customer has chosen, that IS the
 * price. Otherwise the most recently touched one leads, which matches the
 * document the job screen already shows as primary (pickPrimaryDoc) so the
 * headline figure and the detail below it agree. Ties fall back to createdAt
 * and then id, so the answer is stable rather than dependent on read order.
 *
 * Exported for the tests, and because "which quote counts" is a question other
 * surfaces will want answered the same way.
 */
export interface QuoteLike {
  id: string;
  stage?: string;
  total?: number;
  balanceDue?: number;
  updatedAt?: number;
  createdAt?: number;
}

export function representativeQuote<T extends QuoteLike>(
  quotes: T[],
): T | undefined {
  if (quotes.length <= 1) return quotes[0];
  const accepted = quotes.filter((d) => d.stage === 'quote_accepted');
  const pool = accepted.length > 0 ? accepted : quotes;
  return [...pool].sort((a, b) => (
    num(b.updatedAt) - num(a.updatedAt)
    || num(b.createdAt) - num(a.createdAt)
    || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  ))[0];
}

export function computeJobAggregates(
  job: Pick<Job, 'id'>,
  docs: JobDocument[],
): JobAggregates {
  const attached = docs.filter((d) => d.jobId === job.id);

  // Cancelled docs stop contributing to money aggregates but stay listed in
  // documentIds (so the history remains visible on the job card).
  const live = attached.filter((d) => d.stage !== 'cancelled');

  const invoices = live.filter((d) => d.type === 'invoice');
  const quotes = live.filter((d) => d.type === 'quote');

  // One quote counts, never the sum — competing options are alternatives.
  const quote = representativeQuote(quotes);
  const totalQuoted = num(quote?.total);

  const totalInvoiced = invoices.reduce((sum, d) => sum + num(d.total), 0);

  // Money that has actually moved is summed across the live documents. A
  // cancelled one contributes nothing by deliberate design — see the test that
  // pins it. That has one known cost, in a corner this module cannot fix
  // alone: nothing voids a Square link, so a customer can pay one behind a
  // quote that was later withdrawn, and the mirror will not un-cancel the
  // document (`cancelled` outranks `quote_accepted`). The payment lands on the
  // document and is skipped here. quotesSupersededByAccepting therefore
  // refuses to cancel a quote that still carries a payable link, which keeps
  // the app from creating that state itself.
  const totalPaid = live.reduce((sum, d) => sum + num(d.paidTotal), 0);

  // Owing follows the same rule as quoting: every invoice, but only the quote
  // that speaks for the job.
  const balanceDue =
    invoices.reduce((sum, d) => sum + num(d.balanceDue), 0)
    + num(quote?.balanceDue);

  const documentIds = attached
    .map((d) => d.id)
    .filter((id, idx, arr) => arr.indexOf(id) === idx)
    .sort();

  return { totalQuoted, totalInvoiced, totalPaid, balanceDue, documentIds };
}
