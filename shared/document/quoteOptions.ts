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
  /** Unified Document — the link currently offered to the customer. */
  activePaymentLink?: { url?: string | null } | null;
  /** Legacy `quotes` shape. */
  squarePaymentLinkUrl?: string | null;
  depositPaymentLinkUrl?: string | null;
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

function isAccepted(doc: SupersedableQuote): boolean {
  return doc.stage === 'quote_accepted' || doc.status === 'accepted';
}

/**
 * A Square link the customer can still hit. Square links are deliberately
 * never voided — they are left to lapse on their own TTL (see
 * createOrRotatePaymentLink) — so one that exists is one that can still take
 * money.
 */
function hasLivePaymentLink(doc: SupersedableQuote): boolean {
  return !!(doc.activePaymentLink?.url || doc.squarePaymentLinkUrl || doc.depositPaymentLinkUrl);
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
 *  - anything carrying a live Square PAY LINK. Nothing voids those — they are
 *    left to lapse on their own TTL — so the customer can still hit the URL
 *    after we have quietly withdrawn the quote behind it. Cancelling under a
 *    payable link is what makes that trap: the payment lands on a cancelled
 *    quote, and every money aggregate skips cancelled documents, so it would
 *    not even count. A quote someone can still pay is not off the table, and
 *    the app should not pretend otherwise. The tradie can cancel it by hand
 *    once they know.
 *  - anything a customer has PAID on, deposit included. If money has moved
 *    against an option, that option is not hypothetical any more; cancelling
 *    it under the tradie would orphan a real payment. Two options with
 *    deposits is a mess a human has to resolve, and quietly cancelling one
 *    hides it.
 *
 *  - anything ALREADY ACCEPTED. Tidier would be to supersede it as a stale
 *    statement of intent, and that is what this did first — until the race it
 *    opens was worked through. A customer holding two links can accept both
 *    within the same window: each accept writes its own quote, then cancels
 *    the other, and the interleaving where both supersedes land last leaves a
 *    job whose two acceptances have cancelled each other and NO live quote at
 *    all. Refusing to cancel an accepted sibling collapses that to "both
 *    accepted" — the outcome without this feature, and one a human can see and
 *    resolve. Two accepted quotes is untidy; two silently cancelled ones after
 *    the customer said yes twice is a job that has lost the sale.
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
      && !isAccepted(doc)
      && !hasMoneyOnIt(doc)
      && !hasLivePaymentLink(doc)
    ))
    .map((doc) => doc.id);
}

/**
 * The quotes still on the table for a job — its competing options.
 *
 * More than one means the job is an OPTION SET, which changes how the job
 * screen presents it (every option gets an equal card, and the sticky action
 * bar stops offering a Send it cannot attribute to one of them). Invoices are
 * not options, and a superseded quote is no longer on the table.
 *
 * One definition, because the screen renders the list and the action bar asks
 * the question, and the two must never disagree about what an option set is.
 */
export function liveQuoteOptions<T extends SupersedableQuote>(docs: ReadonlyArray<T>): T[] {
  return docs.filter((d) => !isInvoice(d) && !isCancelled(d));
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
