/**
 * Find recent quotes by customer name across all users. PII-stripped output.
 *
 *   cd functions && npx ts-node scripts/findQuoteByCustomer.ts "Jessie"
 */

import * as admin from 'firebase-admin';

async function main() {
  const needle = (process.argv[2] || '').toLowerCase().trim();
  if (!needle) {
    console.error('Usage: npx ts-node scripts/findQuoteByCustomer.ts <name-fragment>');
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();

  const usersSnap = await db.collection('users').get();
  console.log(`Walking ${usersSnap.size} users…\n`);

  for (const u of usersSnap.docs) {
    const uid = u.id;
    const docsSnap = await db
      .collection('users')
      .doc(uid)
      .collection('documents')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    for (const ds of docsSnap.docs) {
      const d = ds.data() as any;
      const name = (d.customerName || '').toLowerCase();
      if (!name.includes(needle)) continue;
      console.log('=== match ===');
      console.log('uid:', uid);
      console.log('docId:', ds.id);
      console.log('number:', d.number);
      console.log('customer:', d.customerName);
      console.log('createdAt:', d.createdAt?.toDate?.()?.toISOString() || d.createdAt);
      console.log('type:', d.type, 'stage:', d.stage);
      console.log('materialsSubtotal:', d.materialsSubtotal, 'total:', d.total);
      console.log('section count:', (d.sections || []).length);
      console.log('material count:', (d.materials || []).length);
      console.log();
      console.log('--- sections ---');
      for (const s of d.sections || []) {
        console.log(`  "${s.name}" mul=${s.multiplier} hrs=${s.laborHours} rate=${s.laborRate} ${s.laborUnit} total=$${s.laborTotal}`);
      }
      console.log();
      console.log('--- materials (showing section assignment) ---');
      for (const m of d.materials || []) {
        const sec = m.section ? `[${m.section}]` : '[(unsectioned)]';
        console.log(`  ${sec.padEnd(35)} ${(m.name || '?').slice(0, 50).padEnd(50)} qty=${m.quantity} ${m.unit || ''} $${m.price} = $${m.totalPrice}`);
      }
      console.log();
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
