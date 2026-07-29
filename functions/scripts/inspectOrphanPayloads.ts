/**
 * Read-only: what is actually inside the reclaimData/ payloads that no
 * accountReclaims record points at, and could they still be delivered?
 *
 *   cd functions && npx ts-node scripts/inspectOrphanPayloads.ts
 *
 * For each orphan: contents, whether the oldUid still exists as a user, and
 * whether any reclaim record or live account matches its customer emails.
 */

import * as admin from 'firebase-admin';

const mask = (e?: string) =>
  e ? `${e.slice(0, 3)}***@${(e.split('@')[1] || '?').slice(0, 14)}` : '—';

async function main() {
  const projectId = process.env.GCLOUD_PROJECT || 'hansendev';
  if (!admin.apps.length) {
    admin.initializeApp({ projectId, storageBucket: process.env.RECLAIM_BUCKET || `${projectId}.firebasestorage.app` });
  }
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const claims = await db.collection('accountReclaims').get();
  const referencedOldUids = new Set(claims.docs.map((c) => c.data().oldUid).filter(Boolean));
  const claimEmails = new Set(claims.docs.map((c) => c.id.toLowerCase()));

  const [files] = await bucket.getFiles({ prefix: 'reclaimData/' });

  // Is the bucket versioned? Decides whether deletion is recoverable.
  const [meta] = await bucket.getMetadata();
  console.log(`\nbucket: ${bucket.name}`);
  console.log(`object versioning: ${meta.versioning?.enabled ? 'ENABLED (deletes recoverable)' : 'DISABLED (deletes are permanent)'}\n`);

  for (const f of files) {
    const oldUid = f.name.replace('reclaimData/', '').replace(/\.json$/, '');
    if (referencedOldUids.has(oldUid)) continue;

    const [buf] = await f.download();
    const payload = JSON.parse(buf.toString('utf8'));
    const quotes: any[] = payload?.quotes ?? [];
    const contacts: any[] = payload?.contacts ?? [];
    const [fmeta] = await f.getMetadata();

    console.log('─'.repeat(76));
    console.log(`ORPHAN  ${f.name}`);
    console.log(`  oldUid        ${oldUid}`);
    console.log(`  size/updated  ${fmeta.size}B / ${fmeta.updated}`);
    console.log(`  quotes ${quotes.length} | contacts ${contacts.length}`);
    console.log(`  payload keys: ${Object.keys(payload).join(', ')}`);

    // Does the old uid still exist as a user doc / auth account?
    const userDoc = await db.collection('users').doc(oldUid).get();
    console.log(`  users/${oldUid.slice(0, 8)}… exists: ${userDoc.exists}`);
    try {
      const u = await admin.auth().getUser(oldUid);
      console.log(`  auth account STILL EXISTS: ${mask(u.email)} disabled=${u.disabled}`);
    } catch {
      console.log(`  auth account: gone (deleted in the incident)`);
    }

    // Any tradie email recorded in the payload itself?
    for (const k of ['tradieEmail', 'email', 'ownerEmail', 'businessEmail']) {
      if (payload[k]) console.log(`  payload.${k} = ${mask(String(payload[k]))} | has reclaim record: ${claimEmails.has(String(payload[k]).toLowerCase())}`);
    }

    console.log(`  quotes:`);
    for (const q of quotes) {
      console.log(
        `    $${String(Number(q.total || 0).toFixed(2)).padStart(10)}  ${q.sentDate || '—'}  ` +
        `${JSON.stringify(String(q.jobTitle || '').slice(0, 44))}  cust=${JSON.stringify(String(q.customerName || '').slice(0, 20))} ${mask(q.customerEmail)}`
      );
    }
    if (contacts.length) {
      console.log(`  contacts: ${contacts.map((c: any) => JSON.stringify(String(c.name || '').slice(0, 18))).join(', ')}`);
    }
  }

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
