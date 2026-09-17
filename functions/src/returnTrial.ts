/**
 * Return-triggered second trial — the Firestore side. Pure maths live in
 * returnTrial.helpers.ts; this applies one ping's plan atomically.
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

import {
  isRecentlyActive,
  planReturnPing,
  returnClockPriorMs,
  ReturnPingPlan,
  ReturnTrialReason,
  RETURN_TRIAL_DAYS,
} from './returnTrial.helpers';

export interface ReturnTrialResult {
  granted: boolean;
  days: number;
  reason?: ReturnTrialReason;
}

/**
 * The slice of the Admin SDK this needs, so a test can hand in a fake and
 * prove the read-before-write ordering and the merge semantics.
 */
export interface ReturnTrialStore {
  doc(path: string): FirebaseFirestore.DocumentReference;
  runTransaction<T>(fn: (tx: FirebaseFirestore.Transaction) => Promise<T>): Promise<T>;
}

/**
 * Stamp this return on users/{uid}/settings/emailState AND, when the tradie
 * has been away long enough on an expired trial, re-open the trial — in one
 * transaction, so the return clock and the grant can never disagree.
 *
 * `activityPatch` is what the ping wants merged onto emailState (the
 * lastActivityAt stamp plus the client version fields). `consider` is the
 * client's supportsReturnTrial flag; without it a qualified account keeps
 * its return clock instead of being granted (see the helpers' header).
 *
 * The common case — active within the last 30 days — costs one read and
 * one write, same as the old plain stamp; the sub doc is only read when the
 * clock alone can't rule the return out.
 */
export async function recordReturnAndMaybeGrantTrial(
  input: {
    uid: string;
    activityPatch: Record<string, unknown>;
    consider: boolean;
    nowMs?: number;
  },
  store: ReturnTrialStore = admin.firestore(),
): Promise<ReturnTrialResult> {
  const nowMs = input.nowMs ?? Date.now();
  const emailStateRef = store.doc(`users/${input.uid}/settings/emailState`);
  const subRef = store.doc(`users/${input.uid}/profile/subscription`);

  const plan = await store.runTransaction(async (tx) => {
    const emailStateSnap = await tx.get(emailStateRef);
    const emailState = emailStateSnap.data();

    let planned: ReturnPingPlan;
    if (isRecentlyActive(returnClockPriorMs(emailState), nowMs)) {
      planned = {
        returnTrialClockAt: new Date(nowMs).toISOString(),
        subPatch: null,
        result: { granted: false, days: RETURN_TRIAL_DAYS, reason: 'recently-active' },
      };
    } else {
      const subSnap = await tx.get(subRef);
      planned = planReturnPing({
        emailState,
        sub: subSnap.exists ? subSnap.data() : undefined,
        consider: input.consider,
        nowMs,
      });
    }

    tx.set(emailStateRef, { ...input.activityPatch, returnTrialClockAt: planned.returnTrialClockAt }, { merge: true });
    if (planned.subPatch) tx.set(subRef, planned.subPatch, { merge: true });
    return planned;
  });

  // Logged after commit, so the line is proof of a grant and not of an attempt.
  if (plan.result.granted) {
    functions.logger.info('returnTrial: granted', { uid: input.uid, days: plan.result.days });
  } else if (plan.result.reason === 'client-unsupported') {
    functions.logger.info('returnTrial: qualified on an unsupported bundle, clock held', { uid: input.uid });
  }
  return plan.result;
}
