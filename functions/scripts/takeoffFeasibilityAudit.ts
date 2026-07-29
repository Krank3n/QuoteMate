/**
 * Read-only audit: does a takeoff-first architecture actually fit the quotes
 * people are creating?
 *
 *   cd functions && npx ts-node scripts/takeoffFeasibilityAudit.ts [limit=400]
 *
 * Needs ADC (gcloud auth application-default login). Writes nothing.
 *
 * Answers three questions the plan depends on:
 *   1. COVERAGE — what share of real jobs carry extractable geometry in the
 *      description? A takeoff layer only pays off on those; the rest must
 *      degrade gracefully.
 *   2. THRESHOLDS — what do per-kg / per-L unit prices and max-line-share
 *      actually look like in the wild, so the cheap guardrails can be
 *      calibrated instead of guessed.
 *   3. INCIDENCE — how often do today's known failure modes (999 clamp,
 *      bulk-price-as-unit-price, one line dominating) actually fire?
 *
 * Output: aggregate stats on stdout. No PII, no per-customer detail.
 */

import * as admin from 'firebase-admin';

// --- geometry extraction -------------------------------------------------
// Deliberately generous: we want the UPPER bound on how many jobs a takeoff
// layer could serve. A miss here understates coverage.
const LINEAR_RE = /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m|metre?s?|meters?|lineal\s*m(?:etre)?s?|lm)\b/i;
const AREA_RE = /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|sqm|sq\.?\s*m|square\s*met(?:re|er)s?)\b/i;
const VOLUME_RE = /\b\d+(?:[.,]\d+)?\s*(?:m3|m³|cubic\s*met(?:re|er)s?|cbm)\b/i;
// "6000 x 600", "3.5m x 2m", "600×400" — two dims multiplied is a takeoff gift.
const DIM_PAIR_RE = /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?\b/i;
const BARE_COUNT_RE = /\b\d+\s*(?:x\b|off\b|of\b)?/i;

type Geo = 'volume' | 'area' | 'dim_pair' | 'linear' | 'count_only' | 'none';

function classifyGeometry(desc: string): { kind: Geo; kinds: string[] } {
  const d = (desc || '').trim();
  const kinds: string[] = [];
  if (VOLUME_RE.test(d)) kinds.push('volume');
  if (AREA_RE.test(d)) kinds.push('area');
  if (DIM_PAIR_RE.test(d)) kinds.push('dim_pair');
  if (LINEAR_RE.test(d)) kinds.push('linear');

  // Most specific wins for the headline bucket.
  let kind: Geo = 'none';
  if (kinds.includes('volume')) kind = 'volume';
  else if (kinds.includes('area')) kind = 'area';
  else if (kinds.includes('dim_pair')) kind = 'dim_pair';
  else if (kinds.includes('linear')) kind = 'linear';
  else if (BARE_COUNT_RE.test(d) && /\d/.test(d)) kind = 'count_only';
  return { kind, kinds };
}

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function quantiles(xs: number[], qs: number[]): Record<string, number> {
  if (!xs.length) return {};
  const s = [...xs].sort((a, b) => a - b);
  const out: Record<string, number> = {};
  for (const q of qs) {
    const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
    out[`p${Math.round(q * 100)}`] = s[i];
  }
  return out;
}

async function main() {
  const limit = Math.max(1, Math.min(parseInt(process.argv[2] || '400', 10), 2000));
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();

  const usersSnap = await db.collection('users').get();
  const docs: any[] = [];
  for (const u of usersSnap.docs) {
    const snap = await db.collection('users').doc(u.id).collection('documents').get();
    for (const d of snap.docs) docs.push({ id: d.id, uid: u.id, ...d.data() });
  }
  docs.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  const recent = docs.slice(0, limit);

  // --- accumulators ------------------------------------------------------
  const geoCounts: Record<string, number> = {};
  const geoByGenerated: Record<string, number> = {};
  let withMaterials = 0;
  let generated = 0; // has materials => went through the pipeline

  const unitHist: Record<string, number> = {};
  const perKgPrices: number[] = [];
  const perLPrices: number[] = [];
  const perM3Prices: number[] = [];
  const maxLineShares: number[] = [];

  let qty999Rows = 0;
  const qty999Docs = new Set<string>();
  let kgOver5 = 0;
  let kgOver20 = 0;
  const kgOver20Examples: string[] = [];
  let dominant40 = 0;
  let dominant60 = 0;
  let zeroPricedRows = 0;
  let totalRows = 0;
  const docTotals: number[] = [];

  // Materials whose unit is a mass/volume unit — the rows a dimensional model
  // would govern. Tracks how much of the money flows through them.
  let bulkUnitRows = 0;
  let bulkUnitValue = 0;
  let allMaterialValue = 0;

  for (const doc of recent) {
    const desc: string = doc?.job?.description || doc?.job?.name || '';
    const mats: any[] = Array.isArray(doc.materials) ? doc.materials : [];
    const g = classifyGeometry(desc);
    geoCounts[g.kind] = (geoCounts[g.kind] || 0) + 1;

    if (mats.length > 0) {
      generated++;
      withMaterials++;
      geoByGenerated[g.kind] = (geoByGenerated[g.kind] || 0) + 1;
    }

    const total = Number(doc.total) || 0;
    if (total > 0) docTotals.push(total);

    let matSubtotal = 0;
    let maxLine = 0;
    for (const m of mats) {
      totalRows++;
      const unit = String(m.unit || 'each');
      unitHist[unit] = (unitHist[unit] || 0) + 1;
      const price = Number(m.price) || 0;
      const qty = Number(m.quantity) || 0;
      const line = Number(m.totalPrice) || price * qty;
      matSubtotal += line;
      if (line > maxLine) maxLine = line;
      allMaterialValue += line;

      if (!(price > 0)) zeroPricedRows++;
      if (qty === 999) {
        qty999Rows++;
        qty999Docs.add(doc.id);
      }
      if (unit === 'kg' || unit === 'L' || unit === 'm³') {
        bulkUnitRows++;
        bulkUnitValue += line;
      }
      if (unit === 'kg' && price > 0) {
        perKgPrices.push(price);
        if (price > 5) kgOver5++;
        if (price > 20) {
          kgOver20++;
          if (kgOver20Examples.length < 12) {
            kgOver20Examples.push(`${String(m.name || '?').slice(0, 44)} — ${qty} kg @ $${price.toFixed(2)} = $${line.toFixed(0)}`);
          }
        }
      }
      if (unit === 'L' && price > 0) perLPrices.push(price);
      if (unit === 'm³' && price > 0) perM3Prices.push(price);
    }

    if (matSubtotal > 0 && mats.length >= 3) {
      const share = maxLine / matSubtotal;
      maxLineShares.push(share);
      if (share >= 0.4) dominant40++;
      if (share >= 0.6) dominant60++;
    }
  }

  // --- report ------------------------------------------------------------
  const n = recent.length;
  console.log(`\n=== TAKEOFF FEASIBILITY AUDIT — ${n} most recent documents (${usersSnap.size} users) ===\n`);

  console.log(`Documents with generated materials: ${generated} (${pct(generated, n)})\n`);

  console.log('--- 1. GEOMETRY COVERAGE (all docs) ---');
  for (const k of ['volume', 'area', 'dim_pair', 'linear', 'count_only', 'none']) {
    const c = geoCounts[k] || 0;
    console.log(`  ${k.padEnd(11)} ${String(c).padStart(4)}  ${pct(c, n).padStart(6)}`);
  }
  const takeoffAble = (geoCounts.volume || 0) + (geoCounts.area || 0) + (geoCounts.dim_pair || 0) + (geoCounts.linear || 0);
  console.log(`  => takeoff-able: ${takeoffAble} / ${n} = ${pct(takeoffAble, n)}`);

  console.log('\n--- 1b. GEOMETRY COVERAGE (docs that ran the pipeline) ---');
  for (const k of ['volume', 'area', 'dim_pair', 'linear', 'count_only', 'none']) {
    const c = geoByGenerated[k] || 0;
    console.log(`  ${k.padEnd(11)} ${String(c).padStart(4)}  ${pct(c, generated).padStart(6)}`);
  }
  const takeoffAbleGen = (geoByGenerated.volume || 0) + (geoByGenerated.area || 0) + (geoByGenerated.dim_pair || 0) + (geoByGenerated.linear || 0);
  console.log(`  => takeoff-able: ${takeoffAbleGen} / ${generated} = ${pct(takeoffAbleGen, generated)}`);

  console.log('\n--- 2. UNIT DISTRIBUTION ---');
  const unitsSorted = Object.entries(unitHist).sort((a, b) => b[1] - a[1]);
  for (const [u, c] of unitsSorted) {
    console.log(`  ${u.padEnd(6)} ${String(c).padStart(5)}  ${pct(c, totalRows).padStart(6)}`);
  }
  console.log(`  total material rows: ${totalRows}`);
  console.log(`  bulk-unit rows (kg/L/m³): ${bulkUnitRows} (${pct(bulkUnitRows, totalRows)}) carrying $${bulkUnitValue.toFixed(0)} of $${allMaterialValue.toFixed(0)} material value (${pct(bulkUnitValue, allMaterialValue)})`);

  console.log('\n--- 3. PER-KG PRICE DISTRIBUTION (threshold calibration) ---');
  console.log(`  n=${perKgPrices.length}`, JSON.stringify(quantiles(perKgPrices, [0.5, 0.75, 0.9, 0.95, 0.99, 1])));
  console.log(`  rows > $5/kg:  ${kgOver5} (${pct(kgOver5, perKgPrices.length)} of kg rows)`);
  console.log(`  rows > $20/kg: ${kgOver20} (${pct(kgOver20, perKgPrices.length)} of kg rows)`);
  if (kgOver20Examples.length) {
    console.log('  examples > $20/kg:');
    for (const e of kgOver20Examples) console.log(`    - ${e}`);
  }
  console.log(`\n  PER-L n=${perLPrices.length}`, JSON.stringify(quantiles(perLPrices, [0.5, 0.9, 0.99, 1])));
  console.log(`  PER-M³ n=${perM3Prices.length}`, JSON.stringify(quantiles(perM3Prices, [0.5, 0.9, 1])));

  console.log('\n--- 4. MAX-LINE-SHARE DISTRIBUTION (dominance threshold calibration) ---');
  console.log(`  n=${maxLineShares.length}`, JSON.stringify(quantiles(maxLineShares, [0.5, 0.75, 0.9, 0.95, 0.99, 1])));
  console.log(`  docs where one line >= 40% of materials: ${dominant40} (${pct(dominant40, maxLineShares.length)})`);
  console.log(`  docs where one line >= 60% of materials: ${dominant60} (${pct(dominant60, maxLineShares.length)})`);

  console.log('\n--- 5. KNOWN FAILURE-MODE INCIDENCE ---');
  console.log(`  rows at the 999 clamp ceiling: ${qty999Rows} across ${qty999Docs.size} documents`);
  console.log(`  zero-priced rows: ${zeroPricedRows} (${pct(zeroPricedRows, totalRows)})`);
  console.log(`  doc total distribution:`, JSON.stringify(quantiles(docTotals, [0.5, 0.9, 0.95, 0.99, 1])));

  await admin.app().delete();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
