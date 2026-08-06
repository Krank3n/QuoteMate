/**
 * Repair: put back the Firebase download tokens the trim backfill wiped.
 *
 * backfillLogoTrim.ts passed
 *     file.save(buf, { metadata: { firebaseStorageDownloadTokens: <token> } })
 * but that object is the Storage *resource* metadata — custom metadata has to
 * sit one level deeper, under `metadata.metadata`. So the intended token was
 * written to a field GCS ignores, and saving replaced the existing custom
 * metadata with nothing. Every trimmed object came out with no token.
 *
 * It hasn't broken anything yet only because storage.rules allows public read
 * on users/**, so ?alt=media serves the bytes regardless of the token. That is
 * luck, not design: tighten those rules and 17 tradies' logos vanish from
 * their quotes and invoices at once.
 *
 * The fix reads the token already baked into each stored logoUri and writes it
 * back onto the object, so the existing URLs become properly authorised again
 * and nothing in Firestore has to change.
 *
 *   npx ts-node scripts/restoreLogoDownloadTokens.ts          # dry run
 *   npx ts-node scripts/restoreLogoDownloadTokens.ts --apply
 */

import * as admin from 'firebase-admin';

const APPLY = process.argv.includes('--apply');

function parse(url: string): { path: string; token: string } | null {
  if (!url?.startsWith('https://firebasestorage.googleapis.com/')) return null;
  const path = url.match(/\/o\/([^?]+)/);
  const token = url.match(/[?&]token=([^&]+)/);
  if (!path || !token) return null;
  return { path: decodeURIComponent(path[1]), token: token[1] };
}

async function main() {
  if (!admin.apps.length) admin.initializeApp({ projectId: 'hansendev' });
  const db = admin.firestore();
  const bucket = admin.storage().bucket('hansendev.firebasestorage.app');

  const users = await db.collection('users').select().get();
  const ids = users.docs.map((d) => d.id);

  let missing = 0;
  let fixed = 0;
  const CHUNK = 40;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const snaps = await Promise.all(
      ids.slice(i, i + CHUNK).map((id) =>
        db.collection('users').doc(id).collection('settings').doc('business').get(),
      ),
    );
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const b: any = snap.data() || {};
      const uid = snap.ref.parent.parent!.id;
      const urls: string[] = [b.logoUri, ...(b.credentials || []).map((c: any) => c?.logoUri)];

      for (const url of urls.filter(Boolean)) {
        const parsed = parse(url);
        if (!parsed) continue;
        let meta: any;
        try {
          [meta] = await bucket.file(parsed.path).getMetadata();
        } catch {
          continue; // object gone — not this script's problem
        }
        if (meta.metadata?.firebaseStorageDownloadTokens) continue; // healthy

        missing++;
        console.log(`${APPLY ? 'FIX ' : 'MISS'} ${uid.slice(0, 12)}  ${parsed.path}`);
        if (APPLY) {
          await bucket.file(parsed.path).setMetadata({
            metadata: { firebaseStorageDownloadTokens: parsed.token },
          });
          fixed++;
        }
      }
    }
  }

  console.log(
    `\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${missing} objects missing a token${APPLY ? `, ${fixed} restored` : '. Re-run with --apply.'}`,
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
