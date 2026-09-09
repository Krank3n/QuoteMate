/**
 * Clear the retired `surchargePaymentFees` flag from every business-settings
 * document.
 *
 * The app and functions stopped reading the flag in September 2026 (RBA ban on
 * card surcharging from 1 October 2026), but an installed build that predates
 * that change still reads it straight from Firestore and would go on adding
 * 2.9% to Tap to Pay charges. Deleting the field switches those builds off too.
 *
 * Read-only by default; prints who would change, nothing else.
 *
 *   cd functions
 *   npx ts-node scripts/retireCardSurcharge.ts            # dry run
 *   npx ts-node scripts/retireCardSurcharge.ts --apply    # delete the field
 *
 * Re-run it while installed builds older than the retirement OTA are still
 * out there: those builds carry the flag in their own save payload, so a
 * tradie on one who opens Business Defaults writes it straight back.
 */

import * as admin from 'firebase-admin';

async function main() {
  const apply = process.argv.includes('--apply');
  const projectId = process.env.GCLOUD_PROJECT || 'hansendev';
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();

  // Projection: `settings` subcollections also hold Square/Xero OAuth token
  // docs. Select only the one field so none of that leaves Firestore.
  const snap = await db.collectionGroup('settings').select('surchargePaymentFees').get();
  let scanned = 0;
  const flagged: FirebaseFirestore.DocumentReference[] = [];
  for (const d of snap.docs) {
    if (d.id !== 'business') continue;
    scanned++;
    if (d.get('surchargePaymentFees') !== undefined) flagged.push(d.ref);
  }
  const on = flagged.length;
  console.log(`business settings scanned: ${scanned}; carrying the field: ${on}`);

  if (!apply) {
    console.log(on ? 'dry run — re-run with --apply to delete the field' : 'nothing to do');
    return;
  }

  let batch = db.batch();
  let inBatch = 0;
  for (const ref of flagged) {
    batch.update(ref, {
      surchargePaymentFees: admin.firestore.FieldValue.delete(),
      surchargeRetiredAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (++inBatch === 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
  }
  if (inBatch) await batch.commit();
  console.log(`cleared surchargePaymentFees on ${on} document(s)`);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
