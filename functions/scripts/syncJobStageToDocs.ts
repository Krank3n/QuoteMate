/**
 * Backfill: align legacy quote status / unified doc stage with the Job stage
 * for jobs where the tradie advanced the Job before our propagation fix
 * landed. Safe to re-run — only writes when there's a real mismatch.
 *
 *   npx ts-node scripts/syncJobStageToDocs.ts <uid>            # dry-run
 *   npx ts-node scripts/syncJobStageToDocs.ts <uid> --commit
 */
import * as admin from 'firebase-admin';

const JOB_TO_QUOTE_STATUS: Record<string, string> = {
  quoted: 'sent',
  accepted: 'accepted',
};
const JOB_TO_DOC_STAGE: Record<string, string> = {
  quoted: 'quote_sent',
  accepted: 'quote_accepted',
};
const QUOTE_LIFECYCLE_DOC_STAGES = new Set(['draft', 'quote_sent', 'quote_accepted']);

async function main() {
  const uid = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!uid) { console.error('Usage: <uid> [--commit]'); process.exit(1); }
  if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);

  const [jobsSnap, docsSnap, quotesSnap] = await Promise.all([
    userRef.collection('jobs').get(),
    userRef.collection('documents').get(),
    userRef.collection('quotes').get(),
  ]);

  const docs = new Map(docsSnap.docs.map((d) => [d.id, d.data() as any]));
  const quotes = new Map(quotesSnap.docs.map((d) => [d.id, d.data() as any]));

  const writes: Array<{ docId: string; quoteId: string; jobStage: string; updates: any }> = [];

  for (const j of jobsSnap.docs) {
    const job = j.data() as any;
    const desiredQuoteStatus = JOB_TO_QUOTE_STATUS[job.stage];
    const desiredDocStage = JOB_TO_DOC_STAGE[job.stage];
    if (!desiredQuoteStatus || !desiredDocStage) continue;

    const docIds: string[] = job.primaryDocumentId
      ? [job.primaryDocumentId, ...(Array.isArray(job.documentIds) ? job.documentIds : [])]
      : (Array.isArray(job.documentIds) ? job.documentIds : []);
    const seen = new Set<string>();
    for (const id of docIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const doc = docs.get(id);
      if (!doc || doc.type !== 'quote') continue;
      if (!QUOTE_LIFECYCLE_DOC_STAGES.has(doc.stage)) continue;
      if (doc.stage === desiredDocStage) continue;
      const updates: any = { stage: desiredDocStage };
      if (doc.draftStep) updates.draftStep = admin.firestore.FieldValue.delete();
      writes.push({ docId: id, quoteId: id, jobStage: job.stage, updates });
    }
  }

  console.log(`\nUser: ${uid}`);
  console.log(`Jobs: ${jobsSnap.size}, Documents: ${docsSnap.size}, Legacy quotes: ${quotesSnap.size}`);
  console.log(`Mismatched docs needing realignment: ${writes.length}`);
  for (const w of writes) {
    const quote = quotes.get(w.quoteId);
    console.log(
      `  -> ${w.docId} jobStage=${w.jobStage} doc.stage=${docs.get(w.docId)?.stage} quote.status=${quote?.status} -> ${JSON.stringify(w.updates)}`,
    );
  }

  if (writes.length === 0) {
    console.log('\nNothing to fix.');
    return;
  }
  if (!commit) {
    console.log('\nDry run — pass --commit to apply.');
    return;
  }

  for (const w of writes) {
    const docRef = userRef.collection('documents').doc(w.docId);
    const quoteRef = userRef.collection('quotes').doc(w.quoteId);
    const quoteUpdates: any = {
      status: JOB_TO_QUOTE_STATUS[w.jobStage],
      updatedAt: new Date(),
    };
    if (w.updates.draftStep) quoteUpdates.draftStep = admin.firestore.FieldValue.delete();
    await docRef.update(w.updates);
    if ((await quoteRef.get()).exists) await quoteRef.update(quoteUpdates);
    console.log(`✓ Realigned ${w.docId}`);
  }
  console.log(`\nApplied ${writes.length} updates.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
