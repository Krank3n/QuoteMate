import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { sanitizeGoals } from './adminGoals.helpers';

// Backs the goals list on /admin/projections. Admin SDK only — the doc sits
// under the rules' default deny, so no client can read or write it directly.

const db = () => admin.firestore();
const goalsDoc = () => db().collection('adminSettings').doc('projectionGoals');

function requireAdmin(context: functions.https.CallableContext): string {
  const uid = context.auth?.uid;
  const isAdmin = context.auth?.token?.admin === true;
  if (!uid || !isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }
  return uid;
}

export const adminGetProjectionGoals = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await goalsDoc().get();
  const d = snap.data() || {};
  return {
    goals: sanitizeGoals(d.goals),
    updatedAt: d.updatedAt || null,
    updatedBy: d.updatedBy || null,
  };
});

// Whole-list replace: the page always sends the full list after an add/remove.
export const adminSaveProjectionGoals = functions.https.onCall(async (data, context) => {
  const uid = requireAdmin(context);
  const goals = sanitizeGoals(data?.goals);
  const updatedAt = Date.now();
  await goalsDoc().set({ goals, updatedAt, updatedBy: uid });
  return { goals, updatedAt };
});
