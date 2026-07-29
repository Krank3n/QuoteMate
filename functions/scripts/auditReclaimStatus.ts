/**
 * Read-only: can restoreRecoveredDocuments be retired?
 *
 *   cd functions && npx ts-node scripts/auditReclaimStatus.ts
 *
 * Decides the question by answering:
 *   1. Of the 107 accountReclaims records, how many are claimed / restored /
 *      still waiting — and what did each restore actually do?
 *   2. Which reclaim emails now have a real Firebase Auth account? (a signed-up
 *      tradie whose claim never linked is invisible in claimedByUid)
 *   3. Which oldUids still have an unconsumed payload in reclaimData/?
 *   4. When did the sweep last do anything?
 * PII-redacted output.
 */

import * as admin from 'firebase-admin';

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}
const mask = (e: string) => `${e.slice(0, 3)}***@${(e.split('@')[1] || '?').slice(0, 12)}`;

async function main() {
  const projectId = process.env.GCLOUD_PROJECT || 'hansendev';
  if (!admin.apps.length) {
    admin.initializeApp({ projectId, storageBucket: process.env.RECLAIM_BUCKET || `${projectId}.firebasestorage.app` });
  }
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const [files] = await bucket.getFiles({ prefix: 'reclaimData/' });
  const payloadByOldUid = new Map<string, number>();
  for (const f of files) {
    const oldUid = f.name.replace('reclaimData/', '').replace(/\.json$/, '');
    try {
      const [buf] = await f.download();
      const p = JSON.parse(buf.toString('utf8'));
      payloadByOldUid.set(oldUid, (p?.quotes ?? []).length);
    } catch {
      payloadByOldUid.set(oldUid, -1);
    }
  }

  const claims = await db.collection('accountReclaims').get();

  let claimed = 0, restoredReal = 0, skippedDevice = 0, noData = 0, pending = 0, unclaimed = 0;
  let authExistsUnclaimed = 0;
  let lastRestoreMs = 0;
  const waitingWithPayload: string[] = [];
  const signedUpButUnclaimed: string[] = [];

  for (const c of claims.docs) {
    const d = c.data();
    const email = c.id;
    const oldUid = d.oldUid as string | undefined;
    const hasPayload = oldUid ? payloadByOldUid.has(oldUid) : false;
    const payloadSize = oldUid ? (payloadByOldUid.get(oldUid) ?? 0) : 0;

    if (d.claimedByUid) {
      claimed++;
      const dr = d.docsRestored;
      if (typeof dr === 'string') {
        if (dr === 'skipped-device-restore') skippedDevice++;
        else if (dr === 'no-recovered-data') noData++;
      } else if (dr && typeof dr === 'object') {
        restoredReal++;
      } else {
        pending++;
      }
      lastRestoreMs = Math.max(lastRestoreMs, tsToMs(d.docsRestoredAt));
    } else {
      unclaimed++;
      if (hasPayload && payloadSize > 0) waitingWithPayload.push(`${mask(email)} (${payloadSize} quotes)`);
      // Did they sign up anyway, without the claim linking?
      try {
        await admin.auth().getUserByEmail(email);
        authExistsUnclaimed++;
        signedUpButUnclaimed.push(mask(email));
      } catch { /* no account — genuinely gone */ }
    }
  }

  console.log(`\n=== accountReclaims: ${claims.size} records ===`);
  console.log(`  claimed:                       ${claimed}`);
  console.log(`    ├─ docs actually injected:   ${restoredReal}`);
  console.log(`    ├─ skipped (device restore): ${skippedDevice}`);
  console.log(`    ├─ skipped (no payload):     ${noData}`);
  console.log(`    └─ claimed, not yet swept:   ${pending}`);
  console.log(`  unclaimed:                     ${unclaimed}`);
  console.log(`    └─ but an Auth account exists for the email: ${authExistsUnclaimed}`);
  console.log(`\n  last sweep action: ${lastRestoreMs ? new Date(lastRestoreMs).toISOString() : 'never'}`);

  console.log(`\n=== payloads ===`);
  console.log(`  reclaimData files: ${files.length}`);
  console.log(`  unclaimed accounts WITH a payload waiting: ${waitingWithPayload.length}`);
  for (const w of waitingWithPayload) console.log(`    - ${w}`);

  if (signedUpButUnclaimed.length) {
    console.log(`\n  !! signed up but claim never linked (${signedUpButUnclaimed.length}):`);
    for (const s of signedUpButUnclaimed.slice(0, 25)) console.log(`    - ${s}`);
  }

  // Are payloads orphaned — no reclaim record points at them at all?
  const referencedOldUids = new Set(claims.docs.map((c) => c.data().oldUid).filter(Boolean));
  const orphanPayloads = [...payloadByOldUid.keys()].filter((u) => !referencedOldUids.has(u));
  console.log(`\n  payloads with no accountReclaims record pointing at them: ${orphanPayloads.length}`);
  for (const o of orphanPayloads.slice(0, 25)) console.log(`    - ${o.slice(0, 10)}… (${payloadByOldUid.get(o)} quotes)`);

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
