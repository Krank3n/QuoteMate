/**
 * Read-only: how many reclaim accounts are still pending injection, and does
 * the source parse itself contain duplicate quotes (same total, same customer)?
 *
 *   cd functions && npx ts-node scripts/inspectReclaimBlastRadius.ts
 */

import * as admin from 'firebase-admin';

async function main() {
  const projectId = process.env.GCLOUD_PROJECT || 'hansendev';
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId,
      storageBucket: process.env.RECLAIM_BUCKET || `${projectId}.firebasestorage.app`,
    });
  }
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const claims = await db.collection('accountReclaims').get();
  let claimed = 0, restored = 0, pending = 0;

  console.log(`\n=== accountReclaims: ${claims.size} total ===\n`);
  for (const c of claims.docs) {
    const d = c.data();
    const isClaimed = !!d.claimedByUid;
    const isRestored = !!d.docsRestoredAt;
    if (isClaimed) claimed++;
    if (isRestored) restored++;
    if (isClaimed && !isRestored) pending++;
    const counts = d.docsRestored ? `q=${d.docsRestored.quotes} c=${d.docsRestored.contacts}` : '—';
    console.log(
      `  ${String(c.id).slice(0, 3)}***  claimed=${isClaimed ? 'Y' : 'n'} restored=${isRestored ? 'Y' : 'n'}  ${counts}`
    );
  }
  console.log(`\n  claimed: ${claimed} | already restored: ${restored} | claimed-but-pending: ${pending}`);
  console.log(`  unclaimed (will inject if they ever sign up): ${claims.size - claimed}`);

  // --- does the SOURCE parse contain duplicates? -------------------------
  console.log(`\n=== source payload duplicate check (reclaimData/*.json) ===\n`);
  const [files] = await bucket.getFiles({ prefix: 'reclaimData/' });
  console.log(`  ${files.length} payload file(s)\n`);

  let totalDupPairs = 0;
  for (const f of files.slice(0, 60)) {
    let payload: any;
    try {
      const [buf] = await f.download();
      payload = JSON.parse(buf.toString('utf8'));
    } catch (e: any) {
      console.log(`  ${f.name}: unreadable (${e.message})`);
      continue;
    }
    const quotes: any[] = payload?.quotes ?? [];
    const byTotal = new Map<string, any[]>();
    for (const q of quotes) {
      const key = `${Number(q.total || 0).toFixed(2)}`;
      if (!byTotal.has(key)) byTotal.set(key, []);
      byTotal.get(key)!.push(q);
    }
    const dups = [...byTotal.entries()].filter(([, v]) => v.length > 1);
    const withNum = quotes.filter((q) => !!q.quoteNumber).length;
    console.log(`  ${f.name}: ${quotes.length} quotes, ${withNum} with quoteNumber, ${quotes.length - withNum} WITHOUT (fall back to idx)`);
    for (const [total, v] of dups) {
      totalDupPairs += v.length - 1;
      console.log(`     dup total $${total} ×${v.length}:`);
      for (const q of v) {
        console.log(`        quoteNumber=${q.quoteNumber || '(none)'}  sent=${q.sentDate || '—'}  title=${JSON.stringify(String(q.jobTitle || '').slice(0, 46))}`);
      }
    }
  }
  console.log(`\n  total duplicate records across payloads: ${totalDupPairs}`);

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
