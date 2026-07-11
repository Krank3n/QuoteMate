/* eslint-disable no-console */
/**
 * Audit (and optionally delete) non-Australian leads created by the
 * Jul 2026 UK-leads incident: Places textsearch for ambiguous suburb names
 * (Liverpool, Newcastle, …) returned UK businesses because the query never
 * named the country and `region=au` is only a ranking bias.
 *
 * Flags a lead when any stored field says it isn't Australian:
 *   - address mentions "United Kingdom" / ", UK"
 *   - state isn't an Australian state/territory (UK leads got "England";
 *     note missing state defaulted to 'NSW', so state alone can't clear a lead)
 *   - postcode isn't a 4-digit Australian postcode (UK: "L3 9AG" style)
 *
 * Usage:
 *   npx ts-node scripts/auditNonAuLeads.ts             # dry-run: list only
 *   npx ts-node scripts/auditNonAuLeads.ts --commit    # delete flagged leads
 */

import * as admin from 'firebase-admin';

const AU_STATES = new Set([
  'NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT',
  'New South Wales', 'Victoria', 'Queensland', 'South Australia',
  'Western Australia', 'Tasmania', 'Northern Territory', 'Australian Capital Territory',
]);

function flagReasons(d: FirebaseFirestore.DocumentData): string[] {
  const reasons: string[] = [];
  const address = String(d.address || '');
  const state = String(d.state || '');
  const postcode = String(d.postcode || '');

  if (/united kingdom|, uk\b/i.test(address)) reasons.push(`address="${address}"`);
  if (state && !AU_STATES.has(state)) reasons.push(`state="${state}"`);
  if (postcode && !/^\d{4}$/.test(postcode)) reasons.push(`postcode="${postcode}"`);
  return reasons;
}

async function main() {
  const commit = process.argv.includes('--commit');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();

  const snap = await db.collection('leads').get();
  console.log(`Scanned ${snap.size} leads`);

  const flagged: { id: string; reasons: string[]; d: FirebaseFirestore.DocumentData }[] = [];
  for (const doc of snap.docs) {
    const reasons = flagReasons(doc.data());
    if (reasons.length) flagged.push({ id: doc.id, reasons, d: doc.data() });
  }

  if (!flagged.length) {
    console.log('No non-AU leads found.');
    return;
  }

  console.log(`\nFlagged ${flagged.length} lead(s):\n`);
  for (const f of flagged) {
    const contacted = ['sent', 'engaged', 'bounced'].includes(f.d.status) ? '  ⚠️ ALREADY CONTACTED' : '';
    console.log(`- ${f.id}  [${f.d.status}]${contacted}`);
    console.log(`    ${f.d.businessName} — suburb=${f.d.suburb}, trade=${f.d.trade}`);
    for (const r of f.reasons) console.log(`    ${r}`);
  }

  if (!commit) {
    console.log(`\nDry-run only. Re-run with --commit to delete these ${flagged.length} lead(s).`);
    return;
  }

  for (const f of flagged) {
    await db.collection('leads').doc(f.id).delete();
    console.log(`deleted ${f.id} (${f.d.businessName})`);
  }
  console.log(`\nDeleted ${flagged.length} lead(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
