/**
 * Move reclaimData/ payloads that no accountReclaims record points at into
 * reclaimData-archive/, so the live prefix holds only deliverable payloads.
 *
 *   cd functions && npx ts-node scripts/archiveOrphanPayloads.ts          # dry run
 *   cd functions && npx ts-node scripts/archiveOrphanPayloads.ts --apply
 *
 * Archive rather than delete: the bucket has object versioning DISABLED, so a
 * delete is permanent and these files are the only surviving trace of their
 * quotes. Copy is verified byte-for-byte before the original is removed.
 * To purge the archive later:  gsutil -m rm -r gs://<bucket>/reclaimData-archive
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const ARCHIVE_PREFIX = 'reclaimData-archive/';

async function main() {
  const apply = process.argv.includes('--apply');
  const projectId = process.env.GCLOUD_PROJECT || 'hansendev';
  if (!admin.apps.length) {
    admin.initializeApp({ projectId, storageBucket: process.env.RECLAIM_BUCKET || `${projectId}.firebasestorage.app` });
  }
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const claims = await db.collection('accountReclaims').get();
  const referenced = new Set(claims.docs.map((c) => c.data().oldUid).filter(Boolean));

  const [files] = await bucket.getFiles({ prefix: 'reclaimData/' });
  const live = files.filter((f) => !f.name.startsWith(ARCHIVE_PREFIX));
  const orphans = live.filter((f) => {
    const oldUid = f.name.replace('reclaimData/', '').replace(/\.json$/, '');
    return !referenced.has(oldUid);
  });

  console.log(`\n${apply ? 'APPLY' : 'DRY RUN'} — ${live.length} payloads in reclaimData/, ${orphans.length} orphaned\n`);

  let moved = 0;
  for (const f of orphans) {
    const [buf] = await f.download();
    const srcHash = crypto.createHash('sha256').update(buf).digest('hex');
    const payload = JSON.parse(buf.toString('utf8'));
    const dest = f.name.replace('reclaimData/', ARCHIVE_PREFIX);
    console.log(`  ${f.name}`);
    console.log(`     → ${dest}  (${buf.length}B, ${(payload.quotes ?? []).length} quotes, sha256 ${srcHash.slice(0, 12)}…)`);

    if (!apply) continue;

    await f.copy(bucket.file(dest));
    // Verify the copy byte-for-byte BEFORE removing the original.
    const [copyBuf] = await bucket.file(dest).download();
    const dstHash = crypto.createHash('sha256').update(copyBuf).digest('hex');
    if (dstHash !== srcHash) {
      console.error(`     !! hash mismatch — original left in place`);
      continue;
    }
    await f.delete();
    console.log(`     ✔ copied + verified, original removed`);
    moved++;
  }

  if (apply) {
    const [after] = await bucket.getFiles({ prefix: 'reclaimData/' });
    const stillLive = after.filter((f) => !f.name.startsWith(ARCHIVE_PREFIX));
    const stillOrphan = stillLive.filter((f) => {
      const oldUid = f.name.replace('reclaimData/', '').replace(/\.json$/, '');
      return !referenced.has(oldUid);
    });
    console.log(`\n  archived ${moved} | reclaimData/ now holds ${stillLive.length} payloads, ${stillOrphan.length} orphaned`);
  } else {
    console.log(`\n  (dry run — nothing changed; re-run with --apply)`);
  }

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
