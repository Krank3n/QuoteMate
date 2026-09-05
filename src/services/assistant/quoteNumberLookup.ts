/**
 * Turn a document NUMBER into the document id the tools take.
 *
 * Mate lost track of a quote id three times in one conversation (4 Sep 2026)
 * and twice fell back to asking the tradie to read out the QU number. That ask
 * was doubly bad: the prompt calls it the move of last resort, and the answer
 * could not be used even once it was given — "QU-001" is a customer-facing
 * label, and every tool takes the Firestore document id instead. So the tradie
 * went and looked something up, read it out, and got nowhere.
 *
 * Mate is now told never to ask. This closes the other half: if a number
 * arrives anyway — the tradie volunteers it, or reads it off the card — it
 * resolves like any other handle instead of 404ing.
 */

/** QU-1042, Q-001, INV-12, IN 12, RP-002 — with or without the separator. */
const DOC_NUMBER_RE = /^(?:qu|q|inv|in|rp)[-\s_]?\d+$/i;

/** Compare "QU-001", "qu 1" and "Q001" as the same label. */
function numberKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * True for something shaped like a document number rather than an id. Firestore
 * ids are long and mixed-case, so there is no overlap in practice.
 */
export function looksLikeDocumentNumber(value: string | undefined | null): boolean {
  return DOC_NUMBER_RE.test(String(value ?? '').trim());
}

export interface NumberedRow {
  id: string;
  number?: string;
}

/**
 * The id of the row carrying this number. Returns undefined when nothing
 * matches, or when two rows share the number — a quote and an invoice can both
 * be "001" in different series, and guessing between them would put a change on
 * the wrong document. Ambiguity is the caller's to report, never to resolve.
 */
export function resolveDocumentNumber(rows: NumberedRow[], wanted: string): string | undefined {
  const key = numberKey(wanted);
  if (!key) return undefined;
  const hits = rows.filter((r) => r.id && numberKey(r.number) === key);
  return hits.length === 1 ? hits[0].id : undefined;
}

export interface CandidateRow extends NumberedRow {
  jobName?: string;
  customerName?: string;
}

/**
 * What to tell Mate when a lookup misses.
 *
 * A bare "Quote not found." is where Mate ran out of moves and started asking
 * the tradie to go and read things off their screen. Naming the recent
 * documents turns a dead end into a choice it can make itself, inside the same
 * turn — and says outright not to make the ask.
 */
export function missingQuoteMessage(requestedId: string, rows: CandidateRow[]): string {
  if (!rows.length) {
    return `No quote with id ${requestedId}, and there are no recent quotes on this account to match it against.`;
  }
  const listed = rows
    .slice(0, 5)
    .map(
      (r) =>
        `${r.id} (${r.number || 'no number'} — ${r.jobName || 'unnamed job'} for ${r.customerName || 'unnamed customer'})`,
    )
    .join('; ');
  return (
    `No quote with id ${requestedId}. Recent ones are: ${listed}. ` +
    `Pick the one the tradie means and use its id — do NOT ask them to read you a quote number.`
  );
}

/** What to tell Mate when a document NUMBER matches nothing it can see. */
export function unresolvedNumberMessage(numberish: string): string {
  return (
    `"${numberish}" is a document number, not a document id, and nothing in the recent list carries it. ` +
    `Call list_recent_quotes with a query (customer or job name) and use the id from that. ` +
    `Do NOT ask the tradie for a number — they cannot give you an id.`
  );
}
