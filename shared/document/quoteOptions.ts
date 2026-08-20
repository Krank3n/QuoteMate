/**
 * Quote options — more than one quote on the same job.
 *
 * A tradie pricing "either a multi-head system, or two independent splits"
 * used to have nowhere to put the second price. Sections looked like the
 * answer and were not: sections are PARTS of one job and get summed, so a
 * quote carrying two alternatives charged the customer for both. In Aug 2026
 * that shipped a $12k quote for a $6k job.
 *
 * The answer is that they are two quotes, not one quote with two prices —
 * because everything downstream of a quote resolves to a single `total`. The
 * acceptance page renders one figure and one Accept button; deposits, Square
 * payment links and quote→invoice conversion all read that number. A quote
 * that meant "one of these two prices" could be sent but never accepted.
 *
 * Jobs already hold many documents (that is how a quote and its invoice live
 * together), so an option is just another quote on the same job.
 *
 * What this module owns is the one rule that keeps them coherent: ACCEPTING
 * ONE OPTION TAKES THE OTHERS OFF THE TABLE. Without it a job sits there with
 * two live quotes and no way to tell which one the customer agreed to — the
 * same ambiguity, moved rather than fixed.
 *
 * Pure and shared: the client accepts through applyStageChange, the customer
 * accepts through the acceptance link on the server, and both have to reach
 * the same answer.
 */

/**
 * The fields this module needs. Deliberately loose so it can read the unified
 * Document (`stage`) and the legacy `quotes` record (`status`) alike — the
 * client and the acceptance-link handler work on different shapes and must
 * not disagree about which quotes to supersede.
 */
export interface SupersedableQuote {
  id: string;
  jobId?: string | null;
  /** Unified Document. Absent on legacy quote records, which are all quotes. */
  type?: 'quote' | 'invoice';
  /** Unified Document. */
  stage?: string | null;
  /** Legacy `quotes` collection. */
  status?: string | null;
  /** Money already taken against this quote. Guards a deposit-paid option. */
  paidTotal?: number | null;
  depositPaid?: number | null;
}

function isInvoice(doc: SupersedableQuote): boolean {
  return doc.type === 'invoice';
}

function isCancelled(doc: SupersedableQuote): boolean {
  return doc.stage === 'cancelled' || doc.status === 'cancelled';
}

/** Any money against a quote means a human has committed to it. */
function hasMoneyOnIt(doc: SupersedableQuote): boolean {
  return (Number(doc.paidTotal) || 0) > 0 || (Number(doc.depositPaid) || 0) > 0;
}

/**
 * The other quotes on this job that accepting `accepted` should take off the
 * table. Returns ids, so callers can write in whatever shape they own.
 *
 * Excluded, and each for a reason worth keeping:
 *
 *  - the accepted quote itself, obviously.
 *  - anything on a DIFFERENT job, or on no job at all. An option only means
 *    anything relative to the job it belongs to; a quote with no jobId has no
 *    siblings by definition, and matching those together would supersede
 *    unrelated work.
 *  - INVOICES. A job's invoice is not a competing option — it is the same
 *    work, further along. Cancelling one because a quote got accepted would
 *    destroy live billing.
 *  - anything already cancelled — nothing to do, and rewriting it would churn
 *    `updatedAt` and reorder the job's documents.
 *  - anything a customer has PAID on, deposit included. If money has moved
 *    against an option, that option is not hypothetical any more; cancelling
 *    it under the tradie would orphan a real payment. Two options with
 *    deposits is a mess a human has to resolve, and quietly cancelling one
 *    hides it.
 *
 * An already-accepted sibling IS superseded (when no money has moved): the
 * accept that just happened is the newer statement of intent, and leaving two
 * accepted quotes on a job is exactly the ambiguity this prevents.
 */
export function quotesSupersededByAccepting(
  accepted: SupersedableQuote,
  all: ReadonlyArray<SupersedableQuote>,
): string[] {
  const jobId = accepted.jobId;
  if (!jobId) return [];
  return all
    .filter((doc) => (
      doc.id !== accepted.id
      && !!doc.jobId
      && doc.jobId === jobId
      && !isInvoice(doc)
      && !isCancelled(doc)
      && !hasMoneyOnIt(doc)
    ))
    .map((doc) => doc.id);
}

/**
 * Whether to offer "add another option" on this document.
 *
 * A second price for the same job is only meaningful while the job is still
 * being quoted. Once it is accepted, invoiced, paid or cancelled the customer
 * has already chosen, and offering another option invites the tradie to quote
 * work that is halfway billed.
 *
 * A DRAFT quote qualifies: pricing option A then option B back to back is the
 * whole point, and making the tradie send the first before writing the second
 * would be backwards. A REJECTED one qualifies too — "not at that price" is
 * exactly when a cheaper alternative earns its place.
 *
 * It needs a job to hang off. An option is defined relative to its siblings,
 * and a quote with no jobId has none.
 */
export function canAddQuoteOption(doc?: SupersedableQuote | null): boolean {
  if (!doc || doc.type === 'invoice' || !doc.jobId) return false;
  const state = doc.stage ?? doc.status;
  return state === 'draft' || state === 'quote_sent' || state === 'sent'
    || state === 'quote_rejected' || state === 'rejected';
}

/**
 * Whether a quote can still be opened and answered through its acceptance
 * link.
 *
 * A cancelled quote cannot. That matters most for options: the customer holds
 * a link for EVERY option they were sent, and accepting one supersedes the
 * rest — but the superseded links are still sitting in their inbox. Without
 * this, they could accept a second option minutes later, and the supersede on
 * that accept would cancel the first, leaving the tradie with a job whose
 * agreed price depends on which email got clicked last.
 *
 * It is the right answer for an ordinary cancelled quote too: a tradie who
 * withdrew a price does not want it accepted an hour later.
 */
export function isQuoteOpenForResponse(doc: SupersedableQuote): boolean {
  return !isCancelled(doc);
}
