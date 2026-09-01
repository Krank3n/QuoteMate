/**
 * Production evidence for the reconcile-pass crash.
 *
 * The scraper returns `description` as an ARRAY of bullet strings. The pricing
 * pipeline stamps it straight onto the material row, and applyReconcileResult's
 * apply branch then feeds that row description to parsePackInfo, which calls
 * .trim() on it and throws. materialsPipeline catches that with a BARE catch,
 * so the whole reconcile pass is abandoned silently — no Sentry event, no user
 * signal.
 *
 * This script does not replay anything. It reads what is actually stored on
 * real customer quotes and counts rows whose `description` is an array — the
 * fingerprint of a row that reached reconcile with the poison value — split
 * around the commit that introduced it (8591643, 17 Aug 2026).
 *
 * Read-only. Prints counts only: no scope text, no customer identity.
 *
 * Usage:
 *   cd functions
 *   set -a; source ../.env; source .env; set +a
 *   npx ts-node scripts/auditReconcileCrash.ts
 */

import * as admin from 'firebase-admin';

/** 8591643 — "fix(materials): half the concrete on one fence quote". */
const REGRESSION_MS = Date.parse('2026-08-17T13:23:57+10:00');

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}

async function main() {
  if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  const db = admin.firestore();

  const users = (await db.collection('users').get()).docs;
  const bucket = (label: string) => ({
    label,
    quotes: 0,
    quotesWithArrayDesc: 0,
    rows: 0,
    arrayDescRows: 0,
    /** Rows carrying pack evidence. NOTE: applyPackAwarePricing stamps these
     *  too, so this is NOT a clean proxy for "reconcile completed" — reported
     *  for context only, and it does indeed move the other way. */
    rowsWithPackStamp: 0,
  });
  const before = bucket('before 17 Aug');
  const after = bucket('17 Aug onwards');

  for (const u of users) {
    const snap = await db.collection('users').doc(u.id).collection('documents').orderBy('createdAt', 'desc').limit(40).get();
    for (const ds of snap.docs) {
      if (ds.id.startsWith('recovered-')) continue;
      const d: any = ds.data();
      if (d.type && d.type !== 'quote') continue;
      const mats: any[] = d.materials || [];
      if (mats.length === 0) continue;
      const created = tsToMs(d.createdAt);
      if (!created) continue;
      const b = created >= REGRESSION_MS ? after : before;
      b.quotes += 1;
      let sawArray = false;
      for (const m of mats) {
        b.rows += 1;
        if (Array.isArray(m.description)) {
          b.arrayDescRows += 1;
          sawArray = true;
        }
        if (m.packSize && m.packUnit) b.rowsWithPackStamp += 1;
      }
      if (sawArray) b.quotesWithArrayDesc += 1;
    }
  }

  for (const b of [before, after]) {
    const pct = (n: number, d: number) => (d === 0 ? '  —' : `${((n / d) * 100).toFixed(1)}%`);
    console.log(`\n${b.label}`);
    console.log(`  quotes with materials      : ${b.quotes}`);
    console.log(`  quotes w/ array description: ${b.quotesWithArrayDesc}  (${pct(b.quotesWithArrayDesc, b.quotes)})`);
    console.log(`  material rows              : ${b.rows}`);
    console.log(`  rows w/ array description  : ${b.arrayDescRows}  (${pct(b.arrayDescRows, b.rows)})`);
    console.log(`  rows carrying pack evidence: ${b.rowsWithPackStamp}  (${pct(b.rowsWithPackStamp, b.rows)})`);
  }
  console.log(
    '\nRead the ARRAY-DESCRIPTION rows. On a successful apply, applyReconcileResult' +
      '\noverwrites m.description with its coverage note (a string) at the END of the' +
      '\nbranch; the throw happens in the middle. So an array left in storage is the' +
      '\nfingerprint of a reconcile that started and died. Pack evidence is NOT a proxy' +
      '\nfor reconcile completing — applyPackAwarePricing stamps it too.\n',
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
