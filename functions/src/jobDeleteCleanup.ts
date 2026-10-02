/**
 * Deleting a job deletes its documents.
 *
 * The app's job delete removes each attached document and then the job. App
 * builds from before Oct 2026 removed only one old-format copy per document
 * (a converted invoice's invoice row — which may not even exist yet), so the
 * unified document survived with its job gone: an invoice with no job, still
 * counted in the tradie's figures. 19 such documents were found in
 * production. Phones run those builds until they update, so the server
 * finishes the delete: once the job is gone, any document still pointing at
 * it goes too, with its old-format copies.
 *
 * Never a document with money on it. The app refuses to delete a job with a
 * paid or part-paid invoice, so one surviving here is unexpected — it is
 * logged and left for a person to look at rather than erased.
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

type AnyData = Record<string, any>;

export interface OrphanCleanupPlan {
  /** Document ids to remove, with every legacy path to delete first. */
  remove: Array<{ id: string; legacyPaths: string[] }>;
  /** Document ids left alone because they carry money. */
  keptWithMoney: string[];
}

/** Which of a deleted job's documents to remove. Pure. */
export function planOrphanCleanup(
  userId: string,
  docs: Array<{ id: string; data: AnyData }>,
): OrphanCleanupPlan {
  const plan: OrphanCleanupPlan = { remove: [], keptWithMoney: [] };
  for (const { id, data } of docs) {
    const hasMoney =
      (Number(data.paidTotal) || 0) > 0 ||
      (Array.isArray(data.payments) && data.payments.some((p: AnyData) => (Number(p?.amount) || 0) > 0));
    if (hasMoney) {
      plan.keptWithMoney.push(id);
      continue;
    }
    const quoteIds = new Set([id, data.legacyQuoteId].filter((x) => typeof x === 'string' && x));
    const invoiceIds = new Set([id, data.legacyInvoiceId].filter((x) => typeof x === 'string' && x));
    plan.remove.push({
      id,
      legacyPaths: [
        ...[...quoteIds].map((q) => `users/${userId}/quotes/${q}`),
        ...[...invoiceIds].map((i) => `users/${userId}/invoices/${i}`),
      ],
    });
  }
  return plan;
}

export const onJobDeletedRemoveDocuments = functions.firestore
  .document('users/{userId}/jobs/{jobId}')
  .onDelete(async (_snap, context) => {
    const { userId, jobId } = context.params as { userId: string; jobId: string };
    const db = admin.firestore();
    const snap = await db.collection('users').doc(userId)
      .collection('documents').where('jobId', '==', jobId).get();
    if (snap.empty) return;
    const plan = planOrphanCleanup(userId, snap.docs.map((d) => ({ id: d.id, data: d.data() })));
    for (const item of plan.remove) {
      await Promise.allSettled(item.legacyPaths.map((p) => db.doc(p).delete()));
      await db.doc(`users/${userId}/documents/${item.id}`).delete().catch(() => undefined);
    }
    functions.logger.info('job_delete_documents_removed', {
      userId, jobId, removed: plan.remove.map((r) => r.id), keptWithMoney: plan.keptWithMoney,
    });
    if (plan.keptWithMoney.length > 0) {
      functions.logger.warn('job_deleted_with_paid_documents', { userId, jobId, documentIds: plan.keptWithMoney });
    }
  });
