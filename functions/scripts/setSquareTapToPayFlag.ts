/**
 * One-shot: write the Tap-to-Pay feature flag at config/squareTapToPay.
 *
 *   { ios: false, android: true }
 *
 * Android ships first; iOS waits on Apple's Tap-to-Pay entitlement before
 * being flipped to true (and the entitlement-bearing build going out).
 *
 * Run: npx ts-node scripts/setSquareTapToPayFlag.ts
 * Needs Application Default Credentials:
 *   firebase login   # or: gcloud auth application-default login
 */

import * as admin from 'firebase-admin';

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT || 'hansendev',
    });
  }
  const db = admin.firestore();
  await db.doc('config/squareTapToPay').set(
    {
      ios: false,
      android: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  console.log('Set config/squareTapToPay → { ios: false, android: true }');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
