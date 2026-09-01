/**
 * How many real customer quotes carry photos or plans?
 *
 * Needed before any image-path model comparison: without real attachments
 * there is nothing to measure, and a synthetic image would tell us nothing
 * about how the pipeline behaves on a tradie's phone snap of a site.
 * Read-only; prints counts and URLs only, never image content.
 */
import * as admin from 'firebase-admin';
import * as fs from 'fs';

async function main() {
  if (!admin.apps.length) admin.initializeApp({ projectId: 'hansendev' });
  const db = admin.firestore();
  const users = (await db.collection('users').get()).docs;
  let quotes = 0, withPhotos = 0, totalPhotos = 0;
  const rows: any[] = [];
  const byTrade: Record<string, number> = {};

  for (const u of users) {
    const snap = await db.collection('users').doc(u.id).collection('documents')
      .orderBy('createdAt', 'desc').limit(40).get();
    for (const ds of snap.docs) {
      if (ds.id.startsWith('recovered-')) continue;
      const d: any = ds.data();
      if (d.type && d.type !== 'quote') continue;
      quotes++;
      const photos: any[] = d.photos || d.job?.photos || [];
      // QuotePhoto.storageUrl — NOT url/uri/downloadUrl. Checking the wrong
      // keys reported zero photos across 535 quotes and nearly killed this
      // experiment before it started.
      const urls = photos.map((p: any) => p?.storageUrl || p?.thumbnailUrl).filter(Boolean);
      const plans = photos.filter((p: any) => p?.isPlan).length;
      if (urls.length === 0) continue;
      withPhotos++;
      totalPhotos += urls.length;
      const desc: string = d.job?.description || '';
      if (desc.length < 40) continue;      // need a scope to compare against
      rows.push({ uid: u.id, docId: ds.id, number: d.number, jobDescription: desc, photoUrls: urls.slice(0, 3), plans });
    }
  }
  for (const r of rows) byTrade[r.number ? 'numbered' : 'draft'] = (byTrade[r.number ? 'numbered' : 'draft'] || 0) + 1;
  console.log(`quotes scanned            : ${quotes}`);
  console.log(`quotes carrying photos    : ${withPhotos}`);
  console.log(`total photos              : ${totalPhotos}`);
  console.log(`usable (photos + a scope) : ${rows.length}`);
  console.log(`  of those, marked as PLANS: ${rows.filter((r) => r.plans > 0).length}`);
  const out = process.env.PHOTO_CORPUS_OUT;
  if (out) { fs.writeFileSync(out, JSON.stringify({ rows }, null, 2)); console.log(`\nwrote ${rows.length} -> ${out}`); }
}
main().catch((e) => { console.error(e); process.exit(1); });
