/**
 * Surgical Jobs-tab repair: walks the affected uid list, finds documents that
 * are orphans (no jobId) or dangling refs (jobId set but Job doesn't exist),
 * and materialises a Job for each — leaving every other Job and document
 * untouched.
 *
 *   npx ts-node scripts/repairOrphansAndDangling.ts            # dry-run
 *   npx ts-node scripts/repairOrphansAndDangling.ts --commit   # write
 *
 * Why not runBackfill: that path groups ALL docs and proposes one Job per
 * group, which duplicates existing Jobs for users who already have a partial
 * Jobs collection (Thiele has 24 jobs / 29 docs — 5 orphans).
 *
 * Strategy:
 *   - orphan doc → create fresh Job at a new id, stamp doc.jobId
 *   - dangling doc → create Job at the EXISTING dangling jobId (so anything
 *     that already referenced it keeps working), no doc update needed
 *
 * Both paths inherit createdAt/updatedAt and stage timestamps from the doc.
 */

import * as admin from 'firebase-admin';

interface DocRecord {
  id: string;
  type?: 'quote' | 'invoice';
  jobId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job?: { name?: string; description?: string };
  stage?: string;
  total?: number;
  paidTotal?: number;
  balanceDue?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  sentAt?: unknown;
  acceptedAt?: unknown;
  respondedAt?: unknown;
  paidInFullAt?: unknown;
  paidAt?: unknown;
}

const AFFECTED_UIDS: ReadonlyArray<{ uid: string; note: string }> = [
  { uid: 'A2TgHfDJkuX3aVZAeNKTi5aKkAe2', note: 'admin@thieleconstructions.com.au' },
  { uid: 'mPtCG8iCCyQdiylyQlgxW6zqxTF3', note: 'distinctivepatioswa@gmail.com' },
  { uid: '5HUJWuUh5ngQ7KsXU2yhBzA1Kno1', note: 'dirdamtereza8@hotmail.com' },
  { uid: 'CwV7ywVxnEhUwXt3I4MYAEbBMLN2', note: 'handyservicesdirect@gmail.com (Tracy)' },
  { uid: 'MgVXHopTE2QGoI4ra92p6hP9pEt2', note: 'justinharbottle@icloud.com' },
  { uid: 'VbPfxa9T6gd2JvIOJ44rTvjrFms2', note: '(no email)' },
  { uid: 'f0lVOq2rpPO20PtbFWglf7sRFT33', note: 'mmcrae@hazws.com' },
];

function toMs(v: unknown): number {
  if (!v) return 0;
  const ts = v as { toMillis?: () => number };
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveJobStage(docStage: string | undefined): string {
  switch (docStage) {
    case 'paid':
      return 'paid';
    case 'invoice_sent':
    case 'partially_paid':
      return 'in_progress';
    case 'quote_accepted':
      return 'accepted';
    case 'quote_sent':
      return 'quoted';
    case 'quote_rejected':
      return 'inquiry';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'inquiry';
  }
}

const STAGE_STAMP_FIELD: Record<string, string | null> = {
  inquiry: null,
  quoted: 'quotedAt',
  accepted: 'acceptedAt',
  scheduled: 'scheduledAt',
  in_progress: 'inProgressAt',
  completed: 'completedAt',
  paid: 'paidAt',
  closed: 'closedAt',
  cancelled: 'cancelledAt',
};

function buildJobFromDoc(
  uid: string,
  jobId: string,
  doc: DocRecord,
): Record<string, unknown> {
  const customerName = (doc.customerName || '').trim();
  const customerEmail = (doc.customerEmail || '').trim();
  const customerPhone = (doc.customerPhone || '').trim();
  const jobAddress = (doc.jobAddress || '').trim();
  const jobName = (doc.job?.name || '').trim();
  const jobDescription = (doc.job?.description || '').trim();

  const stage = deriveJobStage(doc.stage);
  const stampField = STAGE_STAMP_FIELD[stage];
  const sentAt = toMs(doc.sentAt);
  const acceptedAt = toMs(doc.acceptedAt ?? doc.respondedAt);
  const paidAt = toMs(doc.paidInFullAt ?? doc.paidAt);

  const stageStamps: Record<string, number> = {};
  if (sentAt > 0) stageStamps.quotedAt = sentAt;
  if (acceptedAt > 0) stageStamps.acceptedAt = acceptedAt;
  if (paidAt > 0) stageStamps.paidAt = paidAt;
  // If the per-stage stamp for the current stage isn't covered by the
  // document's lifecycle fields, fall back to updatedAt so the JobCard at
  // least has *something* to show as "x ago".
  const docUpdatedAt = toMs(doc.updatedAt);
  if (stampField && !(stampField in stageStamps) && docUpdatedAt > 0) {
    stageStamps[stampField] = docUpdatedAt;
  }

  const total = Number(doc.total) || 0;
  const paidTotal = Number(doc.paidTotal) || 0;
  const balanceDue = Number(doc.balanceDue) || Math.max(total - paidTotal, 0);
  const isInvoice = doc.type === 'invoice';
  const docCreatedAt = toMs(doc.createdAt);
  const now = Date.now();
  const createdAt = docCreatedAt > 0 ? docCreatedAt : now;
  const updatedAt = docUpdatedAt > 0 ? docUpdatedAt : createdAt;

  return {
    id: jobId,
    userId: uid,
    customerName,
    customerEmail,
    customerPhone,
    jobAddress,
    name: jobName || 'Job',
    description: jobDescription,
    stage,
    documentIds: [doc.id],
    primaryDocumentId: doc.id,
    totalQuoted: isInvoice ? 0 : total,
    totalInvoiced: isInvoice ? total : 0,
    totalPaid: paidTotal,
    balanceDue,
    ...stageStamps,
    createdAt,
    updatedAt,
  };
}

function hasSignal(doc: DocRecord): boolean {
  return !!(
    (doc.customerName || '').trim() ||
    (doc.customerEmail || '').trim() ||
    (doc.customerPhone || '').trim() ||
    (doc.jobAddress || '').trim() ||
    (doc.job?.name || '').trim()
  );
}

async function repairUser(uid: string, note: string, commit: boolean) {
  const db = admin.firestore();
  const [docsSnap, jobsSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('documents').get(),
    db.collection('users').doc(uid).collection('jobs').get(),
  ]);

  const existingJobIds = new Set(jobsSnap.docs.map((j) => j.id));
  const docs: DocRecord[] = docsSnap.docs.map(
    (d) => ({ ...(d.data() as DocRecord), id: d.id }),
  );

  const orphans = docs.filter(
    (d) => !d.jobId && d.stage !== 'cancelled' && hasSignal(d),
  );
  const dangling = docs.filter(
    (d) =>
      typeof d.jobId === 'string' &&
      d.jobId &&
      !existingJobIds.has(d.jobId) &&
      d.stage !== 'cancelled' &&
      hasSignal(d),
  );

  console.log(`\n--- ${uid} (${note}) ---`);
  console.log(`  ${docsSnap.size} docs, ${jobsSnap.size} jobs, ${orphans.length} orphans, ${dangling.length} dangling`);

  // Orphans → fresh Job at a new id, stamp doc.jobId
  for (const doc of orphans) {
    const jobRef = db.collection('users').doc(uid).collection('jobs').doc();
    const job = buildJobFromDoc(uid, jobRef.id, doc);
    console.log(
      `    orphan → job ${jobRef.id} [${job.stage}] ${job.customerName || '(no name)'} · ${doc.id}`,
    );
    if (commit) {
      const docRef = db.collection('users').doc(uid).collection('documents').doc(doc.id);
      await db.runTransaction(async (tx) => {
        tx.set(jobRef, job);
        tx.update(docRef, { jobId: jobRef.id });
      });
    }
  }

  // Dangling refs → create Job at the EXISTING dangling jobId, no doc update
  for (const doc of dangling) {
    const jobId = doc.jobId!;
    const jobRef = db.collection('users').doc(uid).collection('jobs').doc(jobId);
    const job = buildJobFromDoc(uid, jobId, doc);
    console.log(
      `    dangling → job ${jobId} [${job.stage}] ${job.customerName || '(no name)'} · ${doc.id}`,
    );
    if (commit) {
      await jobRef.set(job);
    }
  }

  if (commit) {
    await db
      .collection('users').doc(uid)
      .collection('settings').doc('jobsBackfill')
      .set(
        { completedAt: Date.now(), source: 'repair-script', repaired: orphans.length + dangling.length },
        { merge: true },
      );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }

  console.log(`\n=== Surgical Jobs repair for ${AFFECTED_UIDS.length} users ===`);
  console.log(`Mode: ${commit ? 'COMMIT (will write)' : 'DRY-RUN (no writes)'}`);

  for (const { uid, note } of AFFECTED_UIDS) {
    await repairUser(uid, note, commit);
  }

  console.log(`\n${commit ? 'Done.' : 'DRY-RUN done. Re-run with --commit to write.'}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
