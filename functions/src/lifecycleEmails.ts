/**
 * Trial lifecycle emails — five conversion-focused sends anchored to the
 * TRIAL clock (trialStartedAt), not the signup clock:
 *
 *   - trial_start_value  (day 0–1):  value framing + "send that quote today"
 *   - trial_square_pitch (day 3–4):  Path B — turn on payments (skipped when
 *                                    Square is already connected)
 *   - trial_mid_value    (day 7–8):  the user's OWN real numbers; thin data
 *                                    drops the figures
 *   - trial_ending       (≤3 days):  what changes + REAL founding-spots count
 *   - trial_ended        (T+0..3d):  free-plan reassurance + churn question
 *
 * The signup-anchored onboarding drip (sendOnboardingDrip in index.ts) keeps
 * owning activation tips and the never-activated note (tip 5); this function
 * owns the conversion moment. Windows are disjoint and each step is
 * send-once, so a user gets at most one lifecycle email per day and never a
 * stale step. Copy source: website repo marketing/trial-lifecycle-emails.md
 * + the conversion-engine spec (cap-only: no deadlines anywhere).
 *
 * The same run also dispatches the Path B nudge track (squareNudge.helpers):
 *   - square_connected_idle: connected ≥5d, never collected
 *   - square_no_paylink:     trial expired, sent quotes, never connected
 * evaluated only when no lifecycle step is due, so one email/user/day holds.
 *
 * SAFETY
 *   - Dry-run unless LIFECYCLE_LIVE=true in functions/.env. Dry runs log the
 *     exact would-send list.
 *   - The 3-day trial_ended window means going live never backfills users
 *     whose trials lapsed weeks or months ago.
 *   - Send-once flags live in users/{uid}/settings/emailState (one field per
 *     step — see SEND_ONCE_FIELD), stamped only on successful sends.
 *     sendEmail() itself enforces the marketing opt-out and blocks unsendable
 *     domains; isUnreachableEmail() skips the Apple-relay class up front.
 *   - Founding-spots numbers come from config/foundingOffer (computed from
 *     real billed subs). Doc missing or cap filled → the founding copy is
 *     suppressed, never invented.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { listAllAuthUsers } from './authUsers.helpers';
import { isUnreachableEmail } from './reEngagement.helpers';
import {
  lifecycleVerdict,
  midTrialRecap,
  trialEndingVariant,
  SEND_ONCE_FIELD,
  suppressedByOnboardingDrip,
} from './lifecycleEmails.helpers';
import { squareNudgeVerdict, NUDGE_SEND_ONCE_FIELD } from './squareNudge.helpers';
import { isActivatingDoc } from './adminFunnel.helpers';
import { docHasSquarePayment } from './eventFunnel.helpers';
import { ts } from './subscription.helpers';
import {
  sendTrialStartValueEmail,
  sendTrialSquarePitchEmail,
  sendTrialMidValueEmail,
  sendTrialEndingEmail,
  sendTrialEndingNudgeEmail,
  sendTrialEndedEmail,
  sendSquareIdleNudgeEmail,
  sendSquareNoPaylinkNudgeEmail,
  type FoundingSpots,
} from './email';

export const trialLifecycleDaily = functions.pubsub
  .schedule('every day 07:30')
  .timeZone('Australia/Brisbane')
  .onRun(async () => {
    const db = admin.firestore();
    const now = Date.now();
    const live = process.env.LIFECYCLE_LIVE === 'true';

    // Cap-only founding scarcity: real spots from config/foundingOffer, or
    // null → founding copy suppressed.
    let founding: FoundingSpots | null = null;
    try {
      const snap = await db.doc('config/foundingOffer').get();
      const data = snap.data();
      if (data?.capActive && typeof data.spotsLeft === 'number' && data.spotsLeft > 0) {
        founding = { spotsLeft: data.spotsLeft, cap: typeof data.cap === 'number' ? data.cap : 100 };
      }
    } catch {}

    // One documents scan for the nudge track's durable signals: who has ever
    // sent something, and who has ever collected a real Square payment.
    const activatedUids = new Set<string>();
    const squarePaidUids = new Set<string>();
    // Scan success gates the trial_ending nudge variant: a failed scan makes
    // everyone look never-sent, so the variant falls back to standard then.
    let docsScanOk = false;
    try {
      const docsSnap = await db.collectionGroup('documents').get();
      for (const d of docsSnap.docs) {
        const uid = d.ref.parent.parent?.id;
        if (!uid) continue;
        const data = d.data() as any;
        if (isActivatingDoc(data)) activatedUids.add(uid);
        if (docHasSquarePayment(data)) squarePaidUids.add(uid);
      }
      docsScanOk = true;
    } catch (err: any) {
      // Nudges degrade gracefully; lifecycle steps don't depend on the scan.
      functions.logger.error('trialLifecycleDaily: documents scan failed', err?.message);
    }

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

        const stateRef = db.doc(`users/${userId}/settings/emailState`);
        const [subDoc, stateDoc, squareDoc] = await Promise.all([
          db.doc(`users/${userId}/profile/subscription`).get(),
          stateRef.get(),
          db.doc(`users/${userId}/settings/squareConnection`).get(),
        ]);
        if (!subDoc.exists) continue;
        processed++;

        const emailState = stateDoc.data();

        // Same-day cross-campaign suppression: if the onboarding drip
        // emailed this user within the window, sit today out. Steps whose
        // window survives fire tomorrow; ones that don't are skipped.
        if (suppressedByOnboardingDrip(emailState, now)) continue;

        const verdict = lifecycleVerdict(subDoc.data(), emailState, now, {
          hasSquareConnection: squareDoc.exists,
        });
        // Path B nudges only when no lifecycle step is due — one email per
        // user per morning, lifecycle first.
        const nudge = verdict.send
          ? null
          : squareNudgeVerdict(
              {
                sub: subDoc.data(),
                emailState: emailState as any,
                hasSquareConnection: squareDoc.exists,
                connectedAtMs: ts(squareDoc.data()?.connectedAt),
                hasSquarePayment: squarePaidUids.has(userId),
                hasSentDoc: activatedUids.has(userId),
              },
              now
            );
        const send = verdict.send ?? nudge;
        if (!send) continue;

        // trial_ending splits: never-sent users get the personal never-sent
        // note instead of the pricing pitch (same window, same send-once flag).
        const endingVariant =
          send === 'trial_ending'
            ? trialEndingVariant(activatedUids.has(userId), docsScanOk)
            : null;

        if (!live) {
          const label = endingVariant === 'nudge' ? `${send}(nudge)` : send;
          wouldSend.push(`${label} -> ${email} (${userId})`);
          continue;
        }

        let businessName = '';
        try {
          const settingsDoc = await db.doc(`users/${userId}/settings/business`).get();
          businessName = settingsDoc.data()?.businessName || '';
        } catch {}

        let ok = false;
        switch (send) {
          case 'trial_start_value':
            ok = await sendTrialStartValueEmail(email, businessName, userId);
            break;
          case 'trial_square_pitch':
            ok = await sendTrialSquarePitchEmail(email, businessName, userId);
            break;
          case 'trial_mid_value': {
            const docsSnap = await db.collection(`users/${userId}/documents`).get();
            const recap = midTrialRecap(
              docsSnap.docs.map((d) => d.data() as any),
              verdict.trialStartedAt ?? now
            );
            ok = await sendTrialMidValueEmail(email, businessName, recap, userId);
            break;
          }
          case 'trial_ending':
            ok =
              endingVariant === 'nudge'
                ? await sendTrialEndingNudgeEmail(email, businessName, verdict.daysRemaining ?? 3, userId)
                : await sendTrialEndingEmail(email, businessName, verdict.daysRemaining ?? 3, userId, founding);
            break;
          case 'trial_ended':
            ok = await sendTrialEndedEmail(email, businessName, userId, founding);
            break;
          case 'square_connected_idle':
            ok = await sendSquareIdleNudgeEmail(email, businessName, userId);
            break;
          case 'square_no_paylink':
            ok = await sendSquareNoPaylinkNudgeEmail(email, businessName, userId);
            break;
        }

        if (ok) {
          const field = verdict.send
            ? SEND_ONCE_FIELD[verdict.send]
            : NUDGE_SEND_ONCE_FIELD[nudge!];
          await stateRef.set(
            { [field]: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
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
