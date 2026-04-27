/**
 * Per-user document-unification migration runner.
 *
 * Two phases:
 *   1. Mirror legacy quotes/ + invoices/ into the unified documents/
 *      collection (idempotent — skips records the trigger has already
 *      mirrored at >= the source updatedAt).
 *   2. Group those documents into Jobs (the JOBS_REFACTOR_PLAN heuristic):
 *      same customer + address + job name → one Job. Stamps doc.jobId on
 *      each grouped document and creates the Job record.
 *
 * Defaults to dry-run: prints the proposed groupings and exits without
 * touching Firestore. Pass --commit to actually write.
 *
 *   npx ts-node scripts/runUnificationForUser.ts <uid>            # dry-run
 *   npx ts-node scripts/runUnificationForUser.ts <uid> --commit   # commit
 *
 * Run from the functions/ directory. Needs Application Default Credentials:
 *   firebase login    # or: gcloud auth application-default login
 */

import * as admin from 'firebase-admin';

import { mirrorAllForUser, type BackfillSummary } from '../src/documentMirror';
import { runBackfill } from '../src/jobHandlers';

async function main() {
  const args = process.argv.slice(2);
  const uid = args.find((a) => !a.startsWith('--'));
  const commit = args.includes('--commit');

  if (!uid) {
    console.error('Usage: npx ts-node scripts/runUnificationForUser.ts <uid> [--commit]');
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT || 'hansendev',
    });
  }

  console.log(`\n=== Document unification for ${uid} ===`);
  console.log(`Mode: ${commit ? 'COMMIT (will write)' : 'DRY-RUN (no writes)'}\n`);

  // ---------------------------------------------------------------------
  // Phase 1: mirror legacy quotes + invoices into unified documents/.
  // mirrorAllForUser is itself idempotent — re-running is safe and cheap.
  // We always run this so the backfill below sees the latest projection.
  // ---------------------------------------------------------------------
  console.log('Phase 1 — mirror quotes/invoices → documents/');
  const mirrorSummary: BackfillSummary = {
    usersProcessed: 0,
    quotesMirrored: 0,
    invoicesMirrored: 0,
    skipped: 0,
    errors: 0,
    errorSamples: [],
  };
  await mirrorAllForUser(uid, mirrorSummary);
  mirrorSummary.usersProcessed = 1;
  console.log('  Mirror summary:', JSON.stringify(mirrorSummary, null, 2));

  // ---------------------------------------------------------------------
  // Phase 2: group documents into Jobs. runBackfill respects the commit
  // flag — pass false first to see the proposed groupings, then re-run
  // with --commit once you've eyeballed the output.
  // ---------------------------------------------------------------------
  console.log('\nPhase 2 — group documents into Jobs');
  const backfillResult = await runBackfill({ userId: uid, commit });
  console.log(`  Group count: ${backfillResult.groupCount}`);
  console.log(`  Doc count:   ${backfillResult.docCount}`);
  console.log(`  Conflicts:   ${backfillResult.conflicts.length}`);

  if (backfillResult.conflicts.length > 0) {
    console.log('\n  Conflicts (need manual review):');
    for (const c of backfillResult.conflicts) {
      console.log(`    [${c.key}] ${c.reason}`);
      console.log(`      docs: ${c.docIds.join(', ')}`);
    }
  }

  console.log('\n  Proposed groups:');
  for (const g of backfillResult.groups) {
    const customer = g.customerName || '(no name)';
    const addr = g.jobAddress || '(no address)';
    const name = g.jobName || '(no name)';
    console.log(`    [${g.stage}] ${customer} · ${addr} · ${name}`);
    console.log(`      jobId=${g.proposedJobId}  docs=${g.documentIds.length} (${g.documentIds.join(', ')})`);
  }

  if (!commit) {
    console.log('\n--- DRY-RUN done. Re-run with --commit to write the Job records. ---');
  } else {
    console.log('\n--- COMMITTED. Job records written; doc.jobId stamped. ---');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
