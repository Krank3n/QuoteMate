/**
 * Delete orphan Jobs — Jobs that no document references via doc.jobId.
 * These typically arise from `ensureJobForOrphanDocument` firing on a
 * unified document whose jobId later gets overwritten by a mirror trigger
 * projecting a legacy quote/invoice with a different (older) jobId.
 *
 * Usage:
 *   npx ts-node scripts/deleteOrphanJobs.ts <uid>            # dry-run
 *   npx ts-node scripts/deleteOrphanJobs.ts <uid> --commit   # actually delete
 */

import * as admin from 'firebase-admin';

async function main() {
  const uid = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!uid) {
    console.error('Usage: npx ts-node scripts/deleteOrphanJobs.ts <uid> [--commit]');
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);

  const [jobsSnap, docsSnap] = await Promise.all([
    userRef.collection('jobs').get(),
    userRef.collection('documents').get(),
  ]);

  // Collect every jobId referenced by any document.
  const referencedJobIds = new Set<string>();
  for (const d of docsSnap.docs) {
    const jobId = d.data().jobId;
    if (typeof jobId === 'string' && jobId) referencedJobIds.add(jobId);
  }

  const orphans: { id: string; data: any }[] = [];
  for (const j of jobsSnap.docs) {
    const data = j.data();
    if (referencedJobIds.has(j.id)) continue;
    // Sanity guard: don't touch Jobs with attached docs in their own array.
    const docIds = Array.isArray(data.documentIds) ? data.documentIds : [];
    if (docIds.length > 0) continue;
    orphans.push({ id: j.id, data });
  }

  console.log(`\nUser: ${uid}`);
  console.log(`Jobs: ${jobsSnap.size}, Documents: ${docsSnap.size}`);
  console.log(`Referenced job ids: ${referencedJobIds.size}`);
  console.log(`Orphan jobs (no doc points at them, docIds empty): ${orphans.length}`);
  for (const o of orphans) {
    console.log(
      `  -> ${o.id} customer=${o.data.customerName} addr=${o.data.jobAddress} name=${o.data.name} totalQuoted=${o.data.totalQuoted}`,
    );
  }

  if (orphans.length === 0) {
    console.log(`\nNothing to delete.`);
    return;
  }

  if (!commit) {
    console.log(`\nDry run — pass --commit to actually delete.`);
    return;
  }

  const batch = db.batch();
  for (const o of orphans) {
    batch.delete(userRef.collection('jobs').doc(o.id));
  }
  await batch.commit();
  console.log(`\nDeleted ${orphans.length} orphan jobs.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
