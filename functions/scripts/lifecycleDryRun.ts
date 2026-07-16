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
import { squareNudgeVerdict } from '../src/squareNudge.helpers';
import { isActivatingDoc } from '../src/adminFunnel.helpers';
import { docHasSquarePayment } from '../src/eventFunnel.helpers';
import { ts } from '../src/subscription.helpers';
import { listAllAuthUsers } from '../src/authUsers.helpers';
import { isUnreachableEmail } from '../src/reEngagement.helpers';

(async () => {
  const db = admin.firestore();
  const now = Date.now();

  const activatedUids = new Set<string>();
  const squarePaidUids = new Set<string>();
  const docsSnap = await db.collectionGroup('documents').get();
  for (const d of docsSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    const data = d.data() as any;
    if (isActivatingDoc(data)) activatedUids.add(uid);
    if (docHasSquarePayment(data)) squarePaidUids.add(uid);
  }

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
    const send =
      v.send ??
      squareNudgeVerdict(
        {
          sub: subDoc.data(),
          emailState: stateDoc.data() as any,
          hasSquareConnection: squareDoc.exists,
          connectedAtMs: ts(squareDoc.data()?.connectedAt),
          hasSquarePayment: squarePaidUids.has(u.uid),
          hasSentDoc: activatedUids.has(u.uid),
        },
        now
      );
    if (!send) continue;
    tally[send] = (tally[send] || 0) + 1;
    sends.push(`${send} -> ${u.email} (${u.uid})`);
  }

  console.log(JSON.stringify({ wouldSendTally: tally, sends }, null, 2));
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
