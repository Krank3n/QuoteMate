/**
 * One-off: delete a Firebase Auth user + their users/{uid} subtree by email.
 *
 * Dry-run by default. Pass --confirm to actually delete.
 *
 * Usage (from functions/):
 *   npm run build
 *   node lib/scripts/deleteUser.js <email>            # dry-run
 *   node lib/scripts/deleteUser.js <email> --confirm  # actually delete
 *
 * Requires Application Default Credentials:
 *   gcloud auth application-default login
 *   (or GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json)
 */

import * as admin from 'firebase-admin';

const PROJECT_ID = 'hansendev';

// Top-level collections that reference users by a `userId` field.
// We count (but do NOT delete) these so you can decide what to do.
const USER_SCOPED_TOP_LEVEL = [
  'cancellations',
  'quoteAcceptanceTokens',
  'feedback',
  'affiliatePayouts',
  'emailLog',
];

async function main() {
  const args = process.argv.slice(2);
  const email = args.find(a => !a.startsWith('--'));
  const confirm = args.includes('--confirm');

  if (!email) {
    console.error('Usage: ts-node deleteUser.ts <email> [--confirm]');
    process.exit(1);
  }

  admin.initializeApp({ projectId: PROJECT_ID });
  const auth = admin.auth();
  const db = admin.firestore();

  console.log(`\nProject: ${PROJECT_ID}`);
  console.log(`Target:  ${email}`);
  console.log(`Mode:    ${confirm ? 'DELETE' : 'DRY RUN'}\n`);

  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (e: any) {
    console.error(`No Auth user with email ${email} (${e.code || e.message})`);
    process.exit(1);
  }

  const { uid, displayName, metadata } = userRecord;
  console.log(`Found Auth user:`);
  console.log(`  uid:       ${uid}`);
  console.log(`  name:      ${displayName || '(none)'}`);
  console.log(`  created:   ${metadata.creationTime}`);
  console.log(`  lastLogin: ${metadata.lastSignInTime}\n`);

  const userDocRef = db.doc(`users/${uid}`);
  const userDoc = await userDocRef.get();
  console.log(`users/${uid} doc exists: ${userDoc.exists}`);

  const subCollections = await userDocRef.listCollections();
  console.log(`Subcollections under users/${uid}: ${subCollections.length}`);
  for (const col of subCollections) {
    const countSnap = await col.count().get();
    console.log(`  - ${col.id}: ${countSnap.data().count} docs`);
  }

  console.log(`\nTop-level collections referencing userId == "${uid}":`);
  for (const name of USER_SCOPED_TOP_LEVEL) {
    try {
      const snap = await db.collection(name).where('userId', '==', uid).count().get();
      console.log(`  - ${name}: ${snap.data().count} docs`);
    } catch (e: any) {
      console.log(`  - ${name}: query failed (${e.message})`);
    }
  }

  if (!confirm) {
    console.log(`\nDry run complete. Re-run with --confirm to delete Auth user + users/${uid} subtree.`);
    console.log(`(Top-level collections above are NOT touched even with --confirm.)`);
    return;
  }

  console.log(`\nDeleting users/${uid} subtree recursively...`);
  await db.recursiveDelete(userDocRef);
  console.log('  Firestore subtree deleted.');

  console.log(`Deleting Auth user ${uid}...`);
  await auth.deleteUser(uid);
  console.log('  Auth user deleted.');

  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
