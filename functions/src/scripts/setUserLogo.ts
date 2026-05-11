/**
 * One-off: set a user's business logo by email.
 *
 * Reads a logo file from disk, uploads to users/{uid}/logo.{ext} with the
 * matching contentType, removes any prior logo in the other format, and
 * sets logoUri on users/{uid}/settings/business so the app renders it.
 *
 * Dry-run by default. Pass --confirm to actually write.
 *
 * Usage (from functions/):
 *   npm run build
 *   node lib/scripts/setUserLogo.js <email> <path-to-logo>            # dry-run
 *   node lib/scripts/setUserLogo.js <email> <path-to-logo> --confirm  # write
 *
 * Supported formats: .png, .jpg, .jpeg. Convert HEIC to PNG/JPEG first.
 *
 * Requires Application Default Credentials:
 *   gcloud auth application-default login
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const PROJECT_ID = 'hansendev';
const STORAGE_BUCKET = 'hansendev.firebasestorage.app';

function detectFormat(filePath: string): { contentType: string; extension: 'png' | 'jpg' } {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return { contentType: 'image/png', extension: 'png' };
  if (ext === '.jpg' || ext === '.jpeg') return { contentType: 'image/jpeg', extension: 'jpg' };
  throw new Error(`Unsupported extension "${ext}". Use .png, .jpg, or .jpeg.`);
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const email = positional[0];
  const filePath = positional[1];
  const confirm = args.includes('--confirm');

  if (!email || !filePath) {
    console.error('Usage: setUserLogo.js <email> <path-to-logo> [--confirm]');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const { contentType, extension } = detectFormat(filePath);
  const fileBytes = fs.readFileSync(filePath);

  admin.initializeApp({ projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
  const auth = admin.auth();
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  console.log(`\nProject: ${PROJECT_ID}`);
  console.log(`Target:  ${email}`);
  console.log(`Logo:    ${filePath}`);
  console.log(`Format:  ${contentType} (${fileBytes.length} bytes)`);
  console.log(`Mode:    ${confirm ? 'WRITE' : 'DRY RUN'}\n`);

  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (e: any) {
    console.error(`No Auth user with email ${email} (${e.code || e.message})`);
    process.exit(1);
  }
  const { uid } = userRecord;
  console.log(`Found user: ${uid}\n`);

  const storagePath = `users/${uid}/logo.${extension}`;
  const otherExtension = extension === 'png' ? 'jpg' : 'png';
  const otherStoragePath = `users/${uid}/logo.${otherExtension}`;
  const settingsPath = `users/${uid}/settings/business`;

  const [otherExists] = await bucket.file(otherStoragePath).exists();
  console.log(`Plan:`);
  console.log(`  - Upload ${storagePath} (${contentType})`);
  console.log(`  - ${otherExists ? `Delete prior ${otherStoragePath}` : `(no prior ${otherStoragePath})`}`);
  console.log(`  - Update ${settingsPath} { logoUri: <new download url> }`);

  if (!confirm) {
    console.log(`\nDry run complete. Re-run with --confirm to apply.`);
    return;
  }

  const token = randomUUID();
  await bucket.file(storagePath).save(fileBytes, {
    contentType,
    metadata: {
      metadata: { firebaseStorageDownloadTokens: token },
    },
    resumable: false,
  });
  console.log(`\nUploaded ${storagePath}`);

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;

  await db.doc(settingsPath).set(
    { logoUri: downloadUrl, syncedAt: new Date().toISOString() },
    { merge: true }
  );
  console.log(`Updated ${settingsPath}.logoUri`);

  if (otherExists) {
    try {
      await bucket.file(otherStoragePath).delete();
      console.log(`Deleted prior ${otherStoragePath}`);
    } catch (e: any) {
      console.log(`Could not delete ${otherStoragePath}: ${e.message}`);
    }
  }

  console.log(`\nDone.`);
  console.log(`Logo URL: ${downloadUrl}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
