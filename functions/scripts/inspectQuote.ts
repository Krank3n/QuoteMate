import * as admin from 'firebase-admin';

async function main() {
  const uid = process.argv[2];
  const docId = process.argv[3];
  if (!uid || !docId) {
    console.error('Usage: npx ts-node scripts/inspectQuote.ts <uid> <docId>');
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const ref = admin.firestore().collection('users').doc(uid).collection('documents').doc(docId);
  const snap = await ref.get();
  const d = snap.data() as any;
  if (!d) { console.log('not found'); return; }
  console.log('--- Top level ---');
  console.log({
    type: d.type,
    stage: d.stage,
    laborRate: d.laborRate,
    laborHours: d.laborHours,
    laborUnit: d.laborUnit,
    laborTotal: d.laborTotal,
    laborExtraHours: d.laborExtraHours,
    laborMarkup: d.laborMarkup,
    markup: d.markup,
    materialsSubtotal: d.materialsSubtotal,
    subtotal: d.subtotal,
    markupAmount: d.markupAmount,
    gst: d.gst,
    total: d.total,
  });
  console.log('--- Sections ---');
  (d.sections || []).forEach((s: any, i: number) => {
    console.log(`[${i}] ${s.name}`);
    console.log({
      multiplier: s.multiplier,
      laborHours: s.laborHours,
      laborHoursTotal: s.laborHoursTotal,
      laborRate: s.laborRate,
      laborUnit: s.laborUnit,
      laborTotal: s.laborTotal,
    });
    const perUnit = Number(s.laborHours || 0);
    const rate = Number(s.laborRate || 0);
    const mul = Number(s.multiplier || 1);
    const total = Number(s.laborTotal || 0);
    console.log(`  perUnit*rate           = ${perUnit * rate}`);
    console.log(`  perUnit*rate*mul       = ${perUnit * rate * mul}`);
    console.log(`  perUnit*rate*mul*mul   = ${perUnit * rate * mul * mul}`);
    console.log(`  laborTotal             = ${total}`);
  });
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
