/**
 * Can this document still take a scope change?
 *
 * One rule, two enforcers. The store refuses propose_update_quote_scope on a
 * sent quote and tells Mate to draft a new one; the one-job-one-quote guard
 * used to refuse exactly that and point back at the scope tool. Both read this
 * predicate now, so the advice one gives is a door the other opens. See
 * __tests__/sentQuoteDeadEnd.test.ts for the conversation that trapped a tradie
 * between them.
 */

/**
 * True while the document is still the tradie's own draft. Absent status counts
 * as a draft — a quote minted moments ago may not carry one yet, and refusing
 * changes to a brand-new draft is the worse error of the two.
 */
export function canUpdateScope(status: string | null | undefined): boolean {
  return !status || status === 'draft';
}

/**
 * The status to judge, from either shape the app holds a document in: a legacy
 * `Quote` carries `status` ('draft' | 'sent' | …), a unified `Document` carries
 * `stage` ('draft' | 'quote_sent' | …). The vocabularies differ everywhere
 * except the one value this cares about. Reading neither leaves it editable.
 */
export function scopeStatusOf(doc: unknown): string | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const record = doc as { status?: unknown; stage?: unknown };
  if (typeof record.status === 'string') return record.status;
  if (typeof record.stage === 'string') return record.stage;
  return undefined;
}
