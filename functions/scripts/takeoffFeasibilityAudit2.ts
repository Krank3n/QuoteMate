/**
 * Follow-up to takeoffFeasibilityAudit: two questions that decide sequencing.
 *
 *   cd functions && npx ts-node scripts/takeoffFeasibilityAudit2.ts [limit=400]
 *
 * A. Do the big-dollar errors concentrate in geometry-bearing (takeoff-able)
 *    jobs? If yes, takeoff-first is worth building even at ~45% coverage.
 * B. What is actually driving the 25.7% zero-priced row rate — which units,
 *    which kinds of item, how many docs affected, how much money is missing?
 *
 * Read-only. No PII in output.
 */

import * as admin from 'firebase-admin';

const LINEAR_RE = /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m|metre?s?|meters?|lineal\s*m(?:etre)?s?|lm)\b/i;
const AREA_RE = /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|sqm|sq\.?\s*m|square\s*met(?:re|er)s?)\b/i;
const VOLUME_RE = /\b\d+(?:[.,]\d+)?\s*(?:m3|m³|cubic\s*met(?:re|er)s?|cbm)\b/i;
const DIM_PAIR_RE = /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?\b/i;

function hasGeometry(desc: string): boolean {
  const d = (desc || '').trim();
  return VOLUME_RE.test(d) || AREA_RE.test(d) || DIM_PAIR_RE.test(d) || LINEAR_RE.test(d);
}

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}
const pct = (n: number, d: number) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);

// Rough "is this a consumable/incidental?" classifier — the theory being that
// zero-priced rows are mostly small sundries the scraper can't match.
const SUNDRY_RE = /\b(?:string\s*line|chalk|pencil|blade|bit|glove|glasses|mask|tape|rag|brush|broom|bucket|drop\s*sheet|sandpaper|screw|nail|clip|plug|washer|nut|bolt|silicone|sealant|primer|bead|spacer|peg|stake|weep|insert)\b/i;

async function main() {
  const limit = Math.max(1, Math.min(parseInt(process.argv[2] || '400', 10), 2000));
  if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  const db = admin.firestore();

  const usersSnap = await db.collection('users').get();
  const docs: any[] = [];
  for (const u of usersSnap.docs) {
    const snap = await db.collection('users').doc(u.id).collection('documents').get();
    for (const d of snap.docs) docs.push({ id: d.id, uid: u.id, ...d.data() });
  }
  docs.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  const recent = docs.slice(0, limit).filter((d) => Array.isArray(d.materials) && d.materials.length > 0);

  // --- A. where do big-dollar quotes live? -------------------------------
  const withTotals = recent.filter((d) => Number(d.total) > 0);
  const sortedTotals = [...withTotals].sort((a, b) => Number(b.total) - Number(a.total));
  const top10pct = sortedTotals.slice(0, Math.max(1, Math.round(sortedTotals.length * 0.1)));

  const geoAll = withTotals.filter((d) => hasGeometry(d?.job?.description || d?.job?.name || '')).length;
  const geoTop = top10pct.filter((d) => hasGeometry(d?.job?.description || d?.job?.name || '')).length;

  console.log(`\n=== A. BIG-DOLLAR CONCENTRATION (${withTotals.length} priced docs) ===`);
  console.log(`  geometry present, all docs:        ${geoAll}/${withTotals.length} = ${pct(geoAll, withTotals.length)}`);
  console.log(`  geometry present, top 10% by $:    ${geoTop}/${top10pct.length} = ${pct(geoTop, top10pct.length)}`);

  console.log(`\n  top 15 quotes by total:`);
  for (const d of sortedTotals.slice(0, 15)) {
    const desc = String(d?.job?.description || d?.job?.name || '').replace(/\s+/g, ' ').slice(0, 52);
    const mats: any[] = d.materials || [];
    const maxRow = mats.reduce((a: any, m: any) => {
      const line = Number(m.totalPrice) || (Number(m.price) || 0) * (Number(m.quantity) || 0);
      return line > (a?.line ?? 0) ? { line, m } : a;
    }, null as any);
    const ms = Number(d.materialsSubtotal) || 0;
    const share = ms > 0 && maxRow ? (maxRow.line / ms) : 0;
    const geo = hasGeometry(String(d?.job?.description || d?.job?.name || '')) ? 'GEO' : ' — ';
    console.log(
      `   $${String(Math.round(Number(d.total))).padStart(7)} ${geo} | top row ${(share * 100).toFixed(0).padStart(3)}% ` +
      `${maxRow ? `${String(maxRow.m.quantity)} ${String(maxRow.m.unit)} @ $${(Number(maxRow.m.price) || 0).toFixed(2)}` : ''} | ${desc}`
    );
  }

  // --- B. zero-priced anatomy -------------------------------------------
  let rows = 0, zero = 0, zeroSundry = 0;
  const zeroByUnit: Record<string, number> = {};
  const docsWithZero = new Set<string>();
  const zeroPerDoc: number[] = [];
  const zeroNameSamples: string[] = [];
  let docsAllPriced = 0;

  for (const d of recent) {
    const mats: any[] = d.materials || [];
    let z = 0;
    for (const m of mats) {
      rows++;
      const price = Number(m.price) || 0;
      if (price > 0) continue;
      zero++; z++;
      const unit = String(m.unit || 'each');
      zeroByUnit[unit] = (zeroByUnit[unit] || 0) + 1;
      const name = String(m.name || '');
      if (SUNDRY_RE.test(name)) zeroSundry++;
      else if (zeroNameSamples.length < 20) zeroNameSamples.push(name.slice(0, 48));
    }
    if (z > 0) { docsWithZero.add(d.id); zeroPerDoc.push(z / Math.max(1, mats.length)); }
    else docsAllPriced++;
  }

  console.log(`\n=== B. ZERO-PRICED ROW ANATOMY ===`);
  console.log(`  zero-priced rows: ${zero}/${rows} = ${pct(zero, rows)}`);
  console.log(`  documents containing >=1 zero row: ${docsWithZero.size}/${recent.length} = ${pct(docsWithZero.size, recent.length)}`);
  console.log(`  documents fully priced: ${docsAllPriced}/${recent.length} = ${pct(docsAllPriced, recent.length)}`);
  console.log(`  of zero rows, classed as sundry/consumable: ${zeroSundry}/${zero} = ${pct(zeroSundry, zero)}`);
  console.log(`  zero rows by unit:`, JSON.stringify(zeroByUnit));
  const avgShare = zeroPerDoc.length ? zeroPerDoc.reduce((a, b) => a + b, 0) / zeroPerDoc.length : 0;
  console.log(`  mean share of a doc's rows that are unpriced (affected docs): ${(avgShare * 100).toFixed(1)}%`);
  console.log(`  sample NON-sundry unpriced names:`);
  for (const s of zeroNameSamples.slice(0, 15)) console.log(`    - ${s}`);

  // --- C. proposed guardrail precision on real data ----------------------
  // Rule: bulk unit (kg/L/m³/tonne) AND unit price > $20 AND line total > $500
  let fires = 0;
  const fired: string[] = [];
  for (const d of recent) {
    for (const m of (d.materials || [])) {
      const unit = String(m.unit || '');
      const price = Number(m.price) || 0;
      const qty = Number(m.quantity) || 0;
      const line = Number(m.totalPrice) || price * qty;
      if (/^(kg|L|m³|tonne)$/.test(unit) && price > 20 && line > 500) {
        fires++;
        if (fired.length < 15) fired.push(`${String(m.name || '').slice(0, 40)} — ${qty} ${unit} @ $${price.toFixed(2)} = $${line.toFixed(0)}`);
      }
    }
  }
  console.log(`\n=== C. CANDIDATE GUARDRAIL PRECISION ===`);
  console.log(`  rule: unit in (kg,L,m³,tonne) AND price > $20 AND line > $500`);
  console.log(`  fires on ${fires} rows across ${recent.length} docs (${pct(fires, rows)} of all rows)`);
  for (const f of fired) console.log(`    - ${f}`);

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
