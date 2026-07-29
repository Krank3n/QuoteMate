/**
 * Read-only: how bad are the pre-fix duplicates actually sitting in the
 * accounts that were already restored, and do those tradies still use the app?
 *
 *   cd functions && npx ts-node scripts/inspectRestoredAccountDupes.ts
 *
 * Answers "how important is this to fix": phantom count and dollar value, but
 * also whether the account is live (real quotes since restore, subscription).
 * A phantom on a churned account is a rounding error; on an active payer it's
 * a number they look at.
 */

import * as admin from 'firebase-admin';

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  if (typeof t === 'string') { const n = Date.parse(t); return isNaN(n) ? 0 : n; }
  return 0;
}
const day = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

async function main() {
  const projectId = process.env.GCLOUD_PROJECT || 'hansendev';
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const now = Date.now();

  const claims = await db.collection('accountReclaims').get();
  const restored = claims.docs.filter((c) => {
    const dr = c.data().docsRestored;
    return c.data().claimedByUid && dr && typeof dr === 'object';
  });

  console.log(`\n=== ${restored.length} accounts with injected documents ===\n`);

  for (const c of restored) {
    const uid = c.data().claimedByUid as string;
    const email = `${c.id.slice(0, 3)}***@${(c.id.split('@')[1] || '?').slice(0, 14)}`;

    // Documents live under users/{uid}/documents (the client schema); the sweep
    // wrote to users/{uid}/quotes. Check both.
    const [docsSnap, quotesSnap] = await Promise.all([
      db.collection(`users/${uid}/documents`).get(),
      db.collection(`users/${uid}/quotes`).get(),
    ]);

    const all = [
      ...docsSnap.docs.map((d) => ({ id: d.id, coll: 'documents', ...d.data() } as any)),
      ...quotesSnap.docs.map((d) => ({ id: d.id, coll: 'quotes', ...d.data() } as any)),
    ];
    const recovered = all.filter((d) => String(d.id).startsWith('recovered-'));
    const organic = all.filter((d) => !String(d.id).startsWith('recovered-'));

    // Phantoms: recovered docs sharing a total within the same collection.
    const byTotal = new Map<string, any[]>();
    for (const d of recovered) {
      const k = `${d.coll}:${Number(d.total || 0).toFixed(2)}`;
      if (!byTotal.has(k)) byTotal.set(k, []);
      byTotal.get(k)!.push(d);
    }
    const dupGroups = [...byTotal.entries()].filter(([, v]) => v.length > 1);
    const phantomCount = dupGroups.reduce((n, [, v]) => n + v.length - 1, 0);
    const phantomValue = dupGroups.reduce((n, [k, v]) => n + (v.length - 1) * Number(k.split(':')[1]), 0);

    // Is the account alive?
    const lastOrganic = organic.reduce((m, d) => Math.max(m, tsToMs(d.updatedAt), tsToMs(d.createdAt)), 0);
    let sub: any = null;
    try {
      const s = await db.doc(`users/${uid}/profile/subscription`).get();
      sub = s.exists ? s.data() : null;
    } catch { /* ignore */ }

    console.log('─'.repeat(74));
    console.log(`${email}   uid ${uid.slice(0, 8)}…`);
    console.log(`  recovered docs: ${recovered.length}  (documents=${recovered.filter(d=>d.coll==='documents').length} quotes=${recovered.filter(d=>d.coll==='quotes').length})`);
    console.log(`  organic docs:   ${organic.length}   last activity ${day(lastOrganic)}${lastOrganic ? ` (${Math.round((now - lastOrganic) / 86400000)}d ago)` : ''}`);
    console.log(`  PHANTOM duplicates: ${phantomCount}  worth $${phantomValue.toFixed(2)}`);
    for (const [k, v] of dupGroups) {
      console.log(`     $${k.split(':')[1]} ×${v.length}  [${v.map((d: any) => String(d.id).slice(0, 26)).join(', ')}]`);
    }
    console.log(`  subscription: isPro=${sub?.isPro ?? '—'} isBilledSub=${sub?.isBilledSub ?? '—'} status=${sub?.status ?? '—'} trialEnd=${sub?.trialEndDate ? day(tsToMs(sub.trialEndDate)) : '—'}`);
  }

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
