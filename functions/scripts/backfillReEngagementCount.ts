/**
 * backfillReEngagementCount.ts — one-time backfill for the re-engagement
 * lifetime touch cap (REENGAGE_MAX_TOUCHES). Counts each user's historical
 * delivered/sent re-engagement rows in emailLog and writes the total to
 * users/{uid}/settings/emailState.reEngagementCount, so long-inactive users
 * who already received 3+ identical sends stop immediately instead of
 * getting three more.
 *
 * Idempotent: recomputes from emailLog and overwrites the count. Run BEFORE
 * (or after — the cron reads the field either way) deploying the capped
 * sendReEngagement.
 *
 * Run (ADC; gcloud-authed on hansendev):
 *   cd functions && npx tsx scripts/backfillReEngagementCount.ts        # dry run
 *   cd functions && npx tsx scripts/backfillReEngagementCount.ts --live # writes
 */
import * as admin from 'firebase-admin';
admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'hansendev' });

const LIVE = process.argv.includes('--live');

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('emailLog').get();

  const counts = new Map<string, number>();
  for (const doc of snap.docs) {
    const d = doc.data() as any;
    if (!d.userId) continue;
    if (!(d.tags || []).includes('re-engagement')) continue;
    // Only rows that actually reached an inbox count as touches; blocked
    // retry-loop junk from the fixed unreachable bug must not eat the cap.
    if (d.status !== 'delivered' && d.status !== 'sent') continue;
    counts.set(d.userId, (counts.get(d.userId) || 0) + 1);
  }

  const dist = new Map<number, number>();
  for (const n of counts.values()) dist.set(n, (dist.get(n) || 0) + 1);
  console.log(`${counts.size} users with delivered re-engagement sends; distribution:`);
  for (const [touches, users] of [...dist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${touches} touch(es): ${users} users`);
  }

  if (!LIVE) {
    console.log('\nDRY RUN — pass --live to write reEngagementCount.');
    return;
  }

  let written = 0;
  for (const [uid, n] of counts.entries()) {
    await db.doc(`users/${uid}/settings/emailState`).set({ reEngagementCount: n }, { merge: true });
    written++;
  }
  console.log(`\nWrote reEngagementCount for ${written} users.`);
})();
