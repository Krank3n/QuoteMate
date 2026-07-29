/**
 * checkTrialEndingStatus.ts — read-only: for a list of emails, show whether the
 * trial lifecycle cron has already sent trial_ending (or anything else), what
 * it would send on the next run, and every emailLog row for that address.
 *
 *   cd functions && npx tsx scripts/checkTrialEndingStatus.ts a@b.com c@d.com
 */
import * as admin from 'firebase-admin';
admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'hansendev' });

import { lifecycleVerdict, suppressedByOnboardingDrip, trialEndingVariant } from '../src/lifecycleEmails.helpers';
import { deriveSubFields, ts } from '../src/subscription.helpers';
import { isActivatingDoc } from '../src/adminFunnel.helpers';
import { isUnreachableEmail } from '../src/reEngagement.helpers';

const fmt = (v: unknown) => {
  const ms = ts(v);
  return ms === null ? null : new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
};

(async () => {
  const emails = process.argv.slice(2);
  const db = admin.firestore();
  const now = Date.now();

  for (const email of emails) {
    console.log('='.repeat(72));
    console.log(email);
    if (isUnreachableEmail(email)) {
      console.log('  UNREACHABLE ADDRESS — cron skips before any send');
    }
    let uid: string;
    try {
      uid = (await admin.auth().getUserByEmail(email)).uid;
    } catch {
      console.log('  no auth user for this address');
      continue;
    }
    const [subDoc, stateDoc, squareDoc, docsSnap] = await Promise.all([
      db.doc(`users/${uid}/profile/subscription`).get(),
      db.doc(`users/${uid}/settings/emailState`).get(),
      db.doc(`users/${uid}/settings/squareConnection`).get(),
      db.collection(`users/${uid}/documents`).get(),
    ]);
    const state = stateDoc.data() || {};
    const f = deriveSubFields(subDoc.data(), now);
    const hasSent = docsSnap.docs.some((d) => isActivatingDoc(d.data() as any));
    const v = lifecycleVerdict(subDoc.data(), state as any, now, { hasSquareConnection: squareDoc.exists });

    console.log(`  uid=${uid}  subDoc=${subDoc.exists}`);
    console.log(
      `  tier=${f.tier} isPro=${f.isPro} trialStartedAt=${f.trialStartedAt ? new Date(f.trialStartedAt).toISOString().slice(0, 10) : null} daysRemaining=${f.trialDaysRemaining}`
    );
    console.log(`  docs=${docsSnap.size} everSent=${hasSent}`);
    console.log('  emailState:');
    for (const k of Object.keys(state).sort()) {
      const asDate = fmt(state[k]);
      console.log(`    ${k}: ${asDate ?? JSON.stringify(state[k])}`);
    }
    console.log(`  suppressedByDripToday=${suppressedByOnboardingDrip(state, now)}`);
    console.log(
      `  NEXT RUN WOULD SEND: ${v.send ?? 'nothing'}${
        v.send === 'trial_ending' ? ` (variant=${trialEndingVariant(hasSent, true)})` : ''
      }`
    );

    const logs = await db.collection('emailLog').where('to', '==', email).get();
    const rows = logs.docs
      .map((d) => d.data() as any)
      .sort((a, b) => (ts(a.queuedAt) ?? 0) - (ts(b.queuedAt) ?? 0));
    console.log(`  emailLog rows: ${rows.length}`);
    for (const r of rows) {
      console.log(
        `    ${fmt(r.queuedAt)}  ${r.status}  ${r.category}  opens=${r.openCount ?? 0} clicks=${r.clickCount ?? 0}  tags=${(r.tags || []).join(',')}`
      );
    }
  }
  console.log('='.repeat(72));
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
