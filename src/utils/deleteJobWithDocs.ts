/**
 * Helpers for the cascade-delete job flow.
 *
 * Deleting a job used to be blocked whenever any document was attached.
 * The new rule: cascade-delete the attached quotes/invoices alongside the
 * job, EXCEPT when something has been paid — those records belong in the
 * tradie's books, so we steer them to Archive instead.
 */

import type { Document } from '../types/document';
import type { Job } from '../../shared/job/types';

/** Docs whose deletion would erase a paid receipt. Block delete on these
 *  and tell the user to archive the job instead. */
export function pickPaidDocs(docs: Document[]): Document[] {
  return docs.filter(
    (d) => d.stage === 'paid' || d.stage === 'partially_paid',
  );
}

export interface CascadeDeleteDeps {
  deleteQuote: (id: string) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
}

/**
 * Delete attached docs first (quotes via deleteQuote, invoices via
 * deleteInvoice), then the parent job. Order matters — docs go first so
 * the job's documentIds aren't briefly pointing at deleted records.
 */
export async function cascadeDeleteJob(
  job: Job,
  docs: Document[],
  deps: CascadeDeleteDeps,
): Promise<void> {
  for (const d of docs) {
    if (d.type === 'invoice') {
      await deps.deleteInvoice(d.id);
    } else {
      await deps.deleteQuote(d.id);
    }
  }
  await deps.deleteJob(job.id);
}
