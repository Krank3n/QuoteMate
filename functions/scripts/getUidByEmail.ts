/**
 * Tiny helper: print a user's Firebase Auth uid given their email.
 *
 *   npx ts-node scripts/getUidByEmail.ts <email>
 *
 * Run from the functions/ directory. Needs Application Default Credentials.
 */

import * as admin from 'firebase-admin';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx ts-node scripts/getUidByEmail.ts <email>');
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const user = await admin.auth().getUserByEmail(email);
  console.log(user.uid);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
