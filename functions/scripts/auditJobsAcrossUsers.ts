/**
 * Read-only audit: walks every user, counts /documents and /jobs, and reports
 * users whose Jobs tab is incomplete (orphan documents with no jobId, or
 * groups of related docs not yet materialised into a Job).
 *
 *   npx ts-node scripts/auditJobsAcrossUsers.ts
 *
 * Run from the functions/ directory. Needs Application Default Credentials.
 *
 * Output: per-user line with doc count, job count, orphan count, and an
 * estimate of how many Jobs would be created if the backfill ran.
 */

import * as admin from 'firebase-admin';
import { createHash } from 'crypto';

interface DocLike {
  id: string;
  jobId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  job?: { name?: string };
  stage?: string;
}

function groupKey(doc: DocLike): string {
  const customer =
    (doc.customerEmail || doc.customerPhone || '').toString().trim().toLowerCase() ||
    '∅';
  const address = (doc.jobAddress || '').toString().trim().toLowerCase() || '∅';
  const name = (doc.job?.name || '').toString().trim().toLowerCase() || '∅';
  const raw = `${customer}‖${address}‖${name}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

function hasAnySignal(doc: DocLike): boolean {
  return !!(
    (doc.customerName || '').trim() ||
    (doc.customerEmail || '').trim() ||
    (doc.customerPhone || '').trim() ||
    (doc.jobAddress || '').trim() ||
    (doc.job?.name || '').trim()
  );
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();

  console.log('\n=== Jobs-tab health audit ===\n');

  const usersSnap = await db.collection('users').get();
  console.log(`Walking ${usersSnap.size} users…\n`);

  type Row = {
    uid: string;
    email: string;
    docs: number;
    jobs: number;
    orphans: number;
    dangling: number;
    estJobsAfterBackfill: number;
  };
  const rows: Row[] = [];

  for (const u of usersSnap.docs) {
    const uid = u.id;
    let email = '';
    try {
      const auth = await admin.auth().getUser(uid);
      email = auth.email || '';
    } catch {
      // user might exist in Firestore but not Auth (or vice versa)
    }

    const [docsSnap, jobsSnap] = await Promise.all([
      db.collection('users').doc(uid).collection('documents').get(),
      db.collection('users').doc(uid).collection('jobs').get(),
    ]);

    const docs = docsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DocLike));
    const orphans = docs.filter(
      (d) => !d.jobId && d.stage !== 'cancelled' && hasAnySignal(d),
    );

    // Dangling references: doc points at a jobId that doesn't exist in the
    // jobs collection. Tracy's QU-177828 likely landed here — the email-
    // accept handler used to flip status without ensuring the Job existed.
    const jobIds = new Set(jobsSnap.docs.map((j) => j.id));
    const dangling = docs.filter(
      (d) =>
        typeof d.jobId === 'string' &&
        d.jobId &&
        !jobIds.has(d.jobId) &&
        d.stage !== 'cancelled',
    );

    const groupIds = new Set<string>();
    for (const o of orphans) groupIds.add(groupKey(o));
    for (const d of dangling) groupIds.add(groupKey(d));

    rows.push({
      uid,
      email,
      docs: docsSnap.size,
      jobs: jobsSnap.size,
      orphans: orphans.length,
      dangling: dangling.length,
      estJobsAfterBackfill: jobsSnap.size + groupIds.size,
    });
  }

  rows.sort((a, b) => (b.orphans + b.dangling) - (a.orphans + a.dangling));

  const broken = rows.filter((r) => r.orphans > 0 || r.dangling > 0);
  const onlyDocsNoJobs = rows.filter((r) => r.docs > 0 && r.jobs === 0);

  console.log(`USERS WITH ANY GAP: ${broken.length}\n`);

  console.log('  uid                                  email                                    docs  jobs  orphans  dangle  estJobs');
  console.log('  ' + '-'.repeat(125));
  for (const r of broken.slice(0, 80)) {
    const uid = r.uid.padEnd(36);
    const email = (r.email || '(no email)').padEnd(40).slice(0, 40);
    const docs = String(r.docs).padStart(4);
    const jobs = String(r.jobs).padStart(4);
    const orphans = String(r.orphans).padStart(7);
    const dangling = String(r.dangling).padStart(6);
    const est = String(r.estJobsAfterBackfill).padStart(7);
    console.log(`  ${uid} ${email}  ${docs}  ${jobs}  ${orphans}  ${dangling}  ${est}`);
  }

  if (broken.length > 80) {
    console.log(`  …and ${broken.length - 80} more`);
  }

  console.log('\nSummary:');
  console.log(`  Total users:              ${rows.length}`);
  console.log(`  Users with any gap:       ${broken.length}`);
  console.log(`  Users w/ docs but 0 jobs: ${onlyDocsNoJobs.length}`);
  const totalOrphans = rows.reduce((sum, r) => sum + r.orphans, 0);
  const totalDangling = rows.reduce((sum, r) => sum + r.dangling, 0);
  const totalEstNewJobs = rows.reduce(
    (sum, r) => sum + Math.max(0, r.estJobsAfterBackfill - r.jobs),
    0,
  );
  console.log(`  Total orphan documents:   ${totalOrphans}`);
  console.log(`  Total dangling refs:      ${totalDangling}`);
  console.log(`  Total Jobs to be created: ${totalEstNewJobs}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
