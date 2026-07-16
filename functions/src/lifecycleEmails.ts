/**
 * Trial lifecycle emails — the two conversion-critical sends anchored to the
 * TRIAL clock (trialStartedAt), not the signup clock:
 *
 *   - trial_ending: once, when <= 2 days of the 14-day Pro trial remain.
 *   - trial_ended:  once, within 3 days after the trial lapses unconverted.
 *
 * The signup-anchored onboarding drip (sendOnboardingDrip in index.ts) keeps
 * owning activation tips; this function owns the conversion moment. Copy
 * source: website repo marketing/trial-lifecycle-emails.md.
 *
 * SAFETY
 *   - Dry-run by default: sends nothing until LIFECYCLE_LIVE=true is set in
 *     functions/.env (and the function redeployed). Dry runs log the exact
 *     would-send list so the first live run holds no surprises.
 *   - The 3-day trial_ended window means going live never backfills users
 *     whose trials lapsed weeks or months ago.
 *   - Send-once flags live in users/{uid}/settings/emailState
 *     (trialEndingEmailAt / trialEndedEmailAt), stamped only on successful
 *     sends. sendEmail() itself enforces the marketing opt-out and blocks
 *     unsendable domains; isUnreachableEmail() skips the Apple-relay class
 *     before we even read Firestore.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { listAllAuthUsers } from './authUsers.helpers';
import { isUnreachableEmail } from './reEngagement.helpers';
import { lifecycleVerdict } from './lifecycleEmails.helpers';
import { sendTrialEndingEmail, sendTrialEndedEmail } from './email';

export const trialLifecycleDaily = functions.pubsub
  .schedule('every day 07:30')
  .timeZone('Australia/Brisbane')
  .onRun(async () => {
    const db = admin.firestore();
    const now = Date.now();
    const live = process.env.LIFECYCLE_LIVE === 'true';

    const authUsers = await listAllAuthUsers(admin.auth());
    let processed = 0;
    let sent = 0;
    let errors = 0;
    const wouldSend: string[] = [];

    for (const userRecord of authUsers) {
      try {
        const userId = userRecord.uid;
        const email = userRecord.email;
        if (!email || isUnreachableEmail(email)) continue;

        const subDoc = await db.doc(`users/${userId}/profile/subscription`).get();
        if (!subDoc.exists) continue;
        processed++;

        const stateRef = db.doc(`users/${userId}/settings/emailState`);
        const stateDoc = await stateRef.get();
        const verdict = lifecycleVerdict(subDoc.data(), stateDoc.data(), now);
        if (!verdict.send) continue;

        if (!live) {
          wouldSend.push(`${verdict.send} -> ${email} (${userId})`);
          continue;
        }

        let businessName = '';
        try {
          const settingsDoc = await db.doc(`users/${userId}/settings/business`).get();
          businessName = settingsDoc.data()?.businessName || '';
        } catch {}

        const ok =
          verdict.send === 'trial_ending'
            ? await sendTrialEndingEmail(email, businessName, verdict.daysRemaining ?? 2, userId)
            : await sendTrialEndedEmail(email, businessName, userId);

        if (ok) {
          const field = verdict.send === 'trial_ending' ? 'trialEndingEmailAt' : 'trialEndedEmailAt';
          await stateRef.set({ [field]: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          sent++;
        }
      } catch (err: any) {
        errors++;
        functions.logger.error(`trialLifecycleDaily: error for user ${userRecord.uid}`, err?.message);
      }
    }

    if (!live) {
      functions.logger.info(
        `trialLifecycleDaily DRY RUN: processed=${processed}, wouldSend=${wouldSend.length}` +
          (wouldSend.length ? ` -> ${wouldSend.join('; ')}` : '')
      );
    } else {
      functions.logger.info(`trialLifecycleDaily: processed=${processed}, sent=${sent}, errors=${errors}`);
    }
  });
