/**
 * All-users document-unification migration runner.
 *
 * Iterates every user in users/ and runs:
 *   1. mirrorAllForUser — always commits (idempotent, skips already-mirrored
 *      docs by updatedAt). Catches historical data that predates the
 *      onQuoteWritten / onInvoiceWritten triggers.
 *   2. runBackfill — groups documents into Jobs. SKIPS any user that already
 *      has docs in users/{uid}/jobs/ — runBackfill is NOT idempotent on
 *      commit (generates fresh random jobIds each run), so re-running on a
 *      backfilled user would create duplicate Jobs and clobber doc.jobId
 *      pointers.
 *
 * Defaults to dry-run for the jobs phase (mirror always commits — safe).
 * Pass --commit to actually write Job records.
 *
 *   npx ts-node scripts/runUnificationAllUsers.ts            # dry-run jobs
 *   npx ts-node scripts/runUnificationAllUsers.ts --commit   # commit jobs
 *
 * Run from the functions/ directory. Needs Application Default Credentials:
 *   firebase login    # or: gcloud auth application-default login
 */

import * as admin from 'firebase-admin';

import { mirrorAllForUser, type BackfillSummary } from '../src/documentMirror';
import { runBackfill, type BackfillResult } from '../src/jobHandlers';

const USER_PAGE_SIZE = 50;

interface PerUserOutcome {
  userId: string;
  mirrorQuotes: number;
  mirrorInvoices: number;
  mirrorSkipped: number;
  jobsAction: 'skipped-has-jobs' | 'dry-run' | 'committed' | 'errored';
  groupCount?: number;
  docCount?: number;
  conflicts?: number;
  error?: string;
}

async function main() {
  const commit = process.argv.includes('--commit');

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT || 'hansendev',
    });
  }

  const db = admin.firestore();

  console.log('\n=== All-users document unification ===');
  console.log(`Mode: ${commit ? 'COMMIT (will write Jobs)' : 'DRY-RUN (no Job writes)'}`);
  console.log('Mirror phase always commits (idempotent).\n');

  const outcomes: PerUserOutcome[] = [];
  let lastUser: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let usersSeen = 0;

  while (true) {
    let q = db
      .collection('users')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(USER_PAGE_SIZE);
    if (lastUser) q = q.startAfter(lastUser);

    const page = await q.get();
    if (page.empty) break;

    for (const userDoc of page.docs) {
      usersSeen += 1;
      const uid = userDoc.id;

      const perUserMirror: BackfillSummary = {
        usersProcessed: 0,
        quotesMirrored: 0,
        invoicesMirrored: 0,
        skipped: 0,
        errors: 0,
        errorSamples: [],
      };

      const outcome: PerUserOutcome = {
        userId: uid,
        mirrorQuotes: 0,
        mirrorInvoices: 0,
        mirrorSkipped: 0,
        jobsAction: 'dry-run',
      };

      try {
        await mirrorAllForUser(uid, perUserMirror);
        outcome.mirrorQuotes = perUserMirror.quotesMirrored;
        outcome.mirrorInvoices = perUserMirror.invoicesMirrored;
        outcome.mirrorSkipped = perUserMirror.skipped;
      } catch (err: any) {
        outcome.jobsAction = 'errored';
        outcome.error = `mirror: ${err?.message ?? err}`;
        outcomes.push(outcome);
        console.log(`  [${uid}] MIRROR ERROR: ${outcome.error}`);
        continue;
      }

      // Skip backfill if user already has Jobs — runBackfill is non-idempotent
      // on commit and would create duplicates.
      const existingJobs = await db
        .collection('users').doc(uid)
        .collection('jobs')
        .limit(1)
        .get();

      if (!existingJobs.empty) {
        outcome.jobsAction = 'skipped-has-jobs';
        outcomes.push(outcome);
        console.log(
          `  [${uid}] mirror q=${outcome.mirrorQuotes} i=${outcome.mirrorInvoices} skipped=${outcome.mirrorSkipped}  jobs=SKIP (existing)`,
        );
        continue;
      }

      try {
        const result: BackfillResult = await runBackfill({ userId: uid, commit });
        outcome.groupCount = result.groupCount;
        outcome.docCount = result.docCount;
        outcome.conflicts = result.conflicts.length;
        outcome.jobsAction = commit ? 'committed' : 'dry-run';
        console.log(
          `  [${uid}] mirror q=${outcome.mirrorQuotes} i=${outcome.mirrorInvoices} skipped=${outcome.mirrorSkipped}  jobs=${outcome.jobsAction} groups=${result.groupCount} docs=${result.docCount} conflicts=${result.conflicts.length}`,
        );
        if (result.conflicts.length > 0) {
          for (const c of result.conflicts) {
            console.log(`      conflict[${c.key}] ${c.reason} (${c.docIds.length} docs)`);
          }
        }
      } catch (err: any) {
        outcome.jobsAction = 'errored';
        outcome.error = `backfill: ${err?.message ?? err}`;
        console.log(`  [${uid}] BACKFILL ERROR: ${outcome.error}`);
      }

      outcomes.push(outcome);
    }

    lastUser = page.docs[page.docs.length - 1];
    if (page.size < USER_PAGE_SIZE) break;
  }

  // ---------------------------------------------------------------------------
  // Aggregate report
  // ---------------------------------------------------------------------------
  const totalQuotes = outcomes.reduce((s, o) => s + o.mirrorQuotes, 0);
  const totalInvoices = outcomes.reduce((s, o) => s + o.mirrorInvoices, 0);
  const totalSkippedMirror = outcomes.reduce((s, o) => s + o.mirrorSkipped, 0);
  const usersSkippedJobs = outcomes.filter((o) => o.jobsAction === 'skipped-has-jobs').length;
  const usersDryRun = outcomes.filter((o) => o.jobsAction === 'dry-run').length;
  const usersCommitted = outcomes.filter((o) => o.jobsAction === 'committed').length;
  const usersErrored = outcomes.filter((o) => o.jobsAction === 'errored').length;
  const totalGroups = outcomes.reduce((s, o) => s + (o.groupCount ?? 0), 0);
  const totalDocs = outcomes.reduce((s, o) => s + (o.docCount ?? 0), 0);
  const totalConflicts = outcomes.reduce((s, o) => s + (o.conflicts ?? 0), 0);

  console.log('\n=== Summary ===');
  console.log(`Users seen:               ${usersSeen}`);
  console.log(`Mirror — quotes written:  ${totalQuotes}`);
  console.log(`Mirror — invoices written:${totalInvoices}`);
  console.log(`Mirror — skipped (idemp): ${totalSkippedMirror}`);
  console.log(`Jobs — users skipped:     ${usersSkippedJobs}  (already had jobs)`);
  console.log(`Jobs — users dry-run:     ${usersDryRun}`);
  console.log(`Jobs — users committed:   ${usersCommitted}`);
  console.log(`Jobs — users errored:     ${usersErrored}`);
  console.log(`Jobs — total groups:      ${totalGroups}`);
  console.log(`Jobs — total docs grouped:${totalDocs}`);
  console.log(`Jobs — total conflicts:   ${totalConflicts}`);

  if (usersErrored > 0) {
    console.log('\nErrored users:');
    for (const o of outcomes.filter((x) => x.jobsAction === 'errored')) {
      console.log(`  ${o.userId}: ${o.error}`);
    }
  }

  if (!commit) {
    console.log('\n--- DRY-RUN done. Re-run with --commit to write Job records. ---');
  } else {
    console.log('\n--- COMMITTED. Job records written; doc.jobId stamped. ---');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
