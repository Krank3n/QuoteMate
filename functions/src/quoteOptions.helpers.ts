/**
 * Server side of quote options: when a customer accepts one option through
 * the acceptance link, the job's other options come off the table.
 *
 * The decision of WHICH quotes to supersede lives in
 * shared/document/quoteOptions.ts and is shared with the client, so the two
 * accept paths (tradie taps "Mark Approved", customer taps "Accept quote")
 * can't disagree. This module is only the Firestore wiring around it, split
 * out so the wiring itself is testable — the handler it came from is a
 * 300-line onRequest that nothing can exercise.
 */

import { quotesSupersededByAccepting } from './shared/document/quoteOptions';

/** The slice of firestore this needs. Injected so tests can supply a fake. */
export interface QuotesCollectionLike {
  where(field: string, op: '==', value: any): {
    get(): Promise<{ docs: Array<{ id: string; data(): any }> }>;
  };
  doc(id: string): any;
}

export interface SupersedeDeps {
  quotes: QuotesCollectionLike;
  /** Batch factory — `db.batch()`. */
  batch: () => {
    update(ref: any, data: any): void;
    commit(): Promise<any>;
  };
  /** Server timestamp sentinel. */
  now: () => any;
}

export interface SupersedeResult {
  superseded: string[];
  /** Why nothing happened, when nothing did. Surfaces in the log line. */
  skipped?: 'no-job' | 'none-to-supersede';
}

/**
 * Cancel the other quotes on this job. Returns the ids it wrote.
 *
 * Never throws for "nothing to do" — a job with a single quote is the normal
 * case and must not look like a failure in the logs. Real Firestore errors do
 * propagate; the caller decides, and at the accept site that means swallow,
 * because the customer's answer matters more than the bookkeeping.
 */
export async function supersedeSiblingQuotes(
  deps: SupersedeDeps,
  acceptedId: string,
  acceptedQuote: { jobId?: string | null; [k: string]: any },
): Promise<SupersedeResult> {
  const jobId = acceptedQuote.jobId;
  if (!jobId) return { superseded: [], skipped: 'no-job' };

  const snap = await deps.quotes.where('jobId', '==', jobId).get();
  const siblings = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  const ids = quotesSupersededByAccepting(
    { ...acceptedQuote, id: acceptedId, jobId },
    siblings,
  );
  if (ids.length === 0) return { superseded: [], skipped: 'none-to-supersede' };

  const batch = deps.batch();
  for (const id of ids) {
    batch.update(deps.quotes.doc(id), {
      status: 'cancelled',
      updatedAt: deps.now(),
    });
  }
  await batch.commit();
  return { superseded: ids };
}
