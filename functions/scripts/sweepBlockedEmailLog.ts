/**
 * sweepBlockedEmailLog.ts — delete `status == 'blocked'` rows from emailLog.
 *
 * These are overwhelmingly junk from the pre-fix quoteFollowUp/reEngagement
 * retry loops (the same unreachable Apple-relay/test address re-attempted on
 * every tick — ~5.8k rows, >50% of the whole log), and they dilute every
 * stat the admin email views derive from emailLog. The fixed senders skip
 * unsendable addresses BEFORE logging, so blocked rows no longer accumulate;
 * deleting history removes noise, not signal. Delivered/sent/bounced rows are
 * never touched.
 *
 * Run (ADC; gcloud-authed on hansendev):
 *   cd functions && npx tsx scripts/sweepBlockedEmailLog.ts         # dry run
 *   cd functions && npx tsx scripts/sweepBlockedEmailLog.ts --live  # deletes
 */
import * as admin from 'firebase-admin';
admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'hansendev' });

const LIVE = process.argv.includes('--live');

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('emailLog').where('status', '==', 'blocked').get();

  const byTag = new Map<string, number>();
  for (const doc of snap.docs) {
    const tags: string[] = (doc.data().tags || []).filter(
      (t: string) => !t.startsWith('emailLogId:') && !t.startsWith('blocked:') && !t.startsWith('lead:')
    );
    const key = tags.join('/') || '(untagged)';
    byTag.set(key, (byTag.get(key) || 0) + 1);
  }

  console.log(`${snap.size} blocked rows; by type:`);
  for (const [tag, n] of [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${n}× ${tag}`);
  }

  if (!LIVE) {
    console.log('\nDRY RUN — pass --live to delete.');
    return;
  }

  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 500)) batch.delete(doc.ref);
    await batch.commit();
    deleted += Math.min(500, docs.length - i);
    console.log(`  deleted ${deleted}/${docs.length}`);
  }
  console.log(`\nDone — ${deleted} blocked rows removed.`);
})();
