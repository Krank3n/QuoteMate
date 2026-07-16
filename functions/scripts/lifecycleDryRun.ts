/**
 * lifecycleDryRun.ts — read-only preview of what trialLifecycleDaily would
 * send if it ran right now against live data. Mirrors the cron's reads and
 * gating exactly (same lifecycleVerdict, same unreachable-email skip), sends
 * nothing, stamps nothing.
 *
 * Run (ADC; gcloud-authed on hansendev):
 *   cd functions && npx tsx scripts/lifecycleDryRun.ts
 */
import * as admin from 'firebase-admin';
admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'hansendev' });

import { lifecycleVerdict } from '../src/lifecycleEmails.helpers';
import { listAllAuthUsers } from '../src/authUsers.helpers';
import { isUnreachableEmail } from '../src/reEngagement.helpers';

(async () => {
  const db = admin.firestore();
  const now = Date.now();
  const authUsers = await listAllAuthUsers(admin.auth());
  const tally: Record<string, number> = {};
  const sends: string[] = [];

  for (const u of authUsers) {
    if (!u.email || isUnreachableEmail(u.email)) continue;
    const [subDoc, stateDoc, squareDoc] = await Promise.all([
      db.doc(`users/${u.uid}/profile/subscription`).get(),
      db.doc(`users/${u.uid}/settings/emailState`).get(),
      db.doc(`users/${u.uid}/settings/squareConnection`).get(),
    ]);
    if (!subDoc.exists) continue;
    const v = lifecycleVerdict(subDoc.data(), stateDoc.data() as any, now, {
      hasSquareConnection: squareDoc.exists,
    });
    if (!v.send) continue;
    tally[v.send] = (tally[v.send] || 0) + 1;
    sends.push(`${v.send} -> ${u.email} (${u.uid})`);
  }

  console.log(JSON.stringify({ wouldSendTally: tally, sends }, null, 2));
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
