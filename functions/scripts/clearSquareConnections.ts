/**
 * One-shot: delete every users/*\/settings/squareConnection doc.
 * Used during the Square sandbox → production cutover so existing merchants
 * reconnect against production with fresh tokens (and under the new token
 * encryption key).
 *
 * Run: npx ts-node scripts/clearSquareConnections.ts
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
  const snap = await db.collectionGroup('settings').get();

  const toDelete = snap.docs.filter((d) => d.id === 'squareConnection');
  console.log(`Found ${toDelete.length} squareConnection doc(s).`);
  for (const doc of toDelete) {
    console.log('Deleting', doc.ref.path);
    await doc.ref.delete();
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
