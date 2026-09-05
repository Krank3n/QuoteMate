/**
 * Can this document still take a scope change?
 *
 * One rule, two enforcers, and they used to disagree in a way that trapped the
 * tradie. On 4 Sep 2026 a tradie sent a quote, then asked for a change:
 *
 *   1. propose_update_quote_scope was refused by the store — "that quote's
 *      already gone to the customer ... draft a new one instead". Correct: the
 *      customer is holding a PDF, and silently re-pricing what they were sent
 *      is worse than a second document.
 *   2. Mate did exactly as told and called propose_draft_quote — which the
 *      one-job-one-quote guard refused, because a quote for that customer and
 *      job already existed. It told Mate to use propose_update_quote_scope.
 *
 * Each refusal is right on its own; together they are a loop with no exit. Mate
 * bounced between them and the tradie rebuilt the quote by hand ("I tried five
 * times"). This predicate is the single fact both guards now read, so the
 * advice one gives is a door the other opens: once a document is out of draft,
 * the scope tool refuses AND the duplicate guard steps aside.
 */

/** Statuses a quote can hold. Anything past 'draft' has left the building. */
export type EditableStatus = string | null | undefined;

/**
 * True while the document is still the tradie's own draft. Absent status counts
 * as a draft — a quote minted moments ago may not have one yet, and refusing
 * changes to a brand-new draft is the worse error of the two.
 */
export function canUpdateScope(status: EditableStatus): boolean {
  return !status || status === 'draft';
}

/**
 * The status field to judge, from either shape the app holds a document in.
 *
 * A legacy `Quote` carries `status` ('draft' | 'sent' | …); a unified
 * `Document` carries `stage` ('draft' | 'quote_sent' | …). The two vocabularies
 * differ everywhere except the one value this predicate cares about, so
 * reading whichever is present is enough — and reading neither (the caller had
 * only a partial record) correctly leaves the document editable.
 */
export function scopeStatusOf(doc: unknown): string | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const record = doc as { status?: unknown; stage?: unknown };
  if (typeof record.status === 'string') return record.status;
  if (typeof record.stage === 'string') return record.stage;
  return undefined;
}
