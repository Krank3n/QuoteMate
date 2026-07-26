/**
 * Server-side trial bootstrap trigger — see trialBootstrap.helpers.ts for the
 * full rationale. Stamps trialStartedAt on the user's first quote when the
 * client couldn't (pre-1.47 builds blocked by the PAY-02 rules) or didn't.
 *
 * Runs in a transaction so a concurrent client quota write can't be clobbered:
 * we re-read the sub doc and merge only the missing fields.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

import { deriveTrialBootstrapWrite, toMillis } from './trialBootstrap.helpers';

const db = () => admin.firestore();

export const onQuoteCreatedBootstrapTrial = functions.firestore
  .document('users/{userId}/quotes/{quoteId}')
  .onCreate(async (snap, context) => {
    const { userId } = context.params as { userId: string };
    const quoteCreatedAtMs = toMillis(snap.data()?.createdAt);
    const subRef = db().doc(`users/${userId}/profile/subscription`);

    await db().runTransaction(async (tx) => {
      const subSnap = await tx.get(subRef);
      const write = deriveTrialBootstrapWrite(
        subSnap.exists ? subSnap.data() : undefined,
        quoteCreatedAtMs,
        Date.now(),
      );
      if (!write) return;
      tx.set(subRef, write.payload, { merge: true });
    });
  });
