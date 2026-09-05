/**
 * What to tell Mate when a quote lookup misses.
 *
 * Mate lost the quote id three times in one conversation (4 Sep 2026) and twice
 * fell back to asking the tradie to read out the QU number. That ask is the
 * prompt's declared move of last resort, and it could not have worked anyway:
 * the number on the card is a customer-facing label and every tool takes the
 * Firestore document id. The tradie went and looked something up, read it out,
 * and got nowhere.
 *
 * A bare "Quote not found." is what left Mate with nothing better to try.
 * Naming the recent documents turns the miss into a choice Mate can make
 * itself, in the same turn, and says outright not to make the ask.
 *
 * The other half — resolving a number the tradie volunteers anyway — needs no
 * new code: listRecentQuotes already matches a document number through
 * fuzzyScoreQuote, and does it prefix-agnostically ("QU-001", "Q-001", "inv 4"
 * and "#4" all reduce to the digit run), which a prefix-sensitive comparison
 * here would have got wrong.
 */

export interface CandidateRow {
  id: string;
  number?: string;
  jobName?: string;
  customerName?: string;
}

/** How many candidates to name. Enough to choose from, few enough to read. */
const MAX_CANDIDATES = 5;

export function missingQuoteMessage(requestedId: string, rows: CandidateRow[]): string {
  // The prohibition belongs on this branch most of all: with nothing to offer,
  // asking the tradie is the first thing Mate reaches for.
  if (!rows.length) {
    return (
      `No quote with id ${requestedId}, and there are no recent quotes on this account to match it against. ` +
      `Say that plainly and ask which job they mean — do NOT ask them to read you a quote number, ` +
      `they cannot give you an id.`
    );
  }
  const listed = rows
    .slice(0, MAX_CANDIDATES)
    .map(
      (r) =>
        `${r.id} (${r.number || 'no number'} — ${r.jobName || 'unnamed job'} for ${r.customerName || 'unnamed customer'})`,
    )
    .join('; ');
  return (
    `No quote with id ${requestedId}. Recent ones are: ${listed}. ` +
    `Pick the one the tradie means and use its id — do NOT ask them to read you a quote number, ` +
    `they cannot give you an id.`
  );
}
