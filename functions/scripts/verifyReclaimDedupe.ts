/**
 * Read-only verification: run dedupeRecoveredQuotes over the REAL payloads in
 * reclaimData/ and report exactly what it would collapse. Writes nothing.
 *
 *   cd functions && npx ts-node scripts/verifyReclaimDedupe.ts
 */

import * as admin from 'firebase-admin';
import {
  assignUniqueQuoteDocIds,
  dedupeRecoveredQuotes,
  buildRecoveredQuoteDoc,
  type RecoveredQuoteRecord,
} from '../src/accountReclaim.rebuild';

async function main() {
  const projectId = process.env.GCLOUD_PROJECT || 'hansendev';
  if (!admin.apps.length) {
    admin.initializeApp({ projectId, storageBucket: process.env.RECLAIM_BUCKET || `${projectId}.firebasestorage.app` });
  }
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({ prefix: 'reclaimData/' });

  let totalBefore = 0, totalAfter = 0, totalDocsBefore = 0, totalDocsAfter = 0;
  let payloadsChanged = 0;
  // Quotes today's sweep destroys: built, then overwritten by a colliding id,
  // and NOT a notification duplicate (i.e. genuinely distinct money).
  let lostToday = 0, lostValueToday = 0, phantomsToday = 0;

  for (const f of files) {
    let payload: any;
    try {
      const [buf] = await f.download();
      payload = JSON.parse(buf.toString('utf8'));
    } catch {
      continue;
    }
    const quotes: RecoveredQuoteRecord[] = payload?.quotes ?? [];
    const deduped = dedupeRecoveredQuotes(quotes);

    const build = (rs: RecoveredQuoteRecord[]) =>
      rs.map((r, i) => buildRecoveredQuoteDoc(r, i, 'x@x.co'))
        .filter((d): d is Record<string, unknown> => d !== null);
    // BEFORE = today's behaviour: colliding ids silently overwrite on write.
    const rawBefore = build(quotes);
    const docsBefore = [...new Map(rawBefore.map((d) => [String(d.id), d])).values()];
    const docsAfter = assignUniqueQuoteDocIds(build(deduped));

    totalBefore += quotes.length;
    totalAfter += deduped.length;
    totalDocsBefore += docsBefore.length;
    totalDocsAfter += docsAfter.length;

    // What today's sweep actually lands vs what the fixed sweep lands,
    // compared as a multiset of totals (money is the identity here).
    const bag = (ds: Array<Record<string, unknown>>) => {
      const m = new Map<string, number>();
      for (const d of ds) {
        const k = Number(d.total).toFixed(2);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    const nowBag = bag(docsBefore);
    const fixedBag = bag(docsAfter);
    for (const [k, want] of fixedBag) {
      const got = nowBag.get(k) ?? 0;
      if (got < want) { lostToday += want - got; lostValueToday += (want - got) * Number(k); }
    }
    for (const [k, got] of nowBag) {
      const want = fixedBag.get(k) ?? 0;
      if (got > want) phantomsToday += got - want;
    }

    const name = f.name.replace('reclaimData/', '').slice(0, 12);
    if (deduped.length !== quotes.length) {
      payloadsChanged++;
      console.log(`\n  ${name}…  ${quotes.length} → ${deduped.length} records  (docs ${docsBefore.length} → ${docsAfter.length})`);
      const kept = new Set(deduped.map((r) => JSON.stringify(r)));
      for (const q of quotes) {
        const survived = kept.has(JSON.stringify(q)) || deduped.some((d) => d.jobTitle === q.jobTitle && d.total === q.total);
        if (!survived) {
          console.log(`      DROPPED  $${Number(q.total || 0).toFixed(2)}  ${JSON.stringify(String(q.jobTitle || '').slice(0, 56))}`);
        }
      }
    } else {
      console.log(`  ${name}…  ${quotes.length} records — unchanged`);
    }

    // Invariant: no two surviving docs may share a total AND an id collision.
    const ids = docsAfter.map((d: any) => d.id);
    if (new Set(ids).size !== ids.length) {
      console.log(`      !! ID COLLISION in ${name}: ${ids.length - new Set(ids).size} repeated`);
    }
  }

  console.log(`\n=== ${files.length} payloads | ${payloadsChanged} changed ===`);
  console.log(`  records: ${totalBefore} → ${totalAfter}  (−${totalBefore - totalAfter})`);
  console.log(`  written docs: ${totalDocsBefore} → ${totalDocsAfter}  (−${totalDocsBefore - totalDocsAfter})`);
  console.log(`  quotes LOST to id collision today: ${lostToday}`);
  console.log(`  phantom duplicate quotes written today: ${phantomsToday}`);
  console.log(`  net $ of quotes recovered that today's sweep destroys: $${lostValueToday.toFixed(2)}`);

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
