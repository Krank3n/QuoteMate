/**
 * Read-only: when did reclaims actually get claimed? Decides whether the
 * sweep is still serving live traffic or has gone dormant.
 *
 *   cd functions && npx ts-node scripts/auditReclaimTimeline.ts
 */

import * as admin from 'firebase-admin';

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}

async function main() {
  const projectId = process.env.GCLOUD_PROJECT || 'hansendev';
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const claims = await db.collection('accountReclaims').get();

  const rows: Array<{ email: string; claimedAt: number; restoredAt: number; outcome: string }> = [];
  for (const c of claims.docs) {
    const d = c.data();
    if (!d.claimedByUid) continue;
    const dr = d.docsRestored;
    rows.push({
      email: `${c.id.slice(0, 3)}***`,
      claimedAt: tsToMs(d.claimedAt),
      restoredAt: tsToMs(d.docsRestoredAt),
      outcome: typeof dr === 'string' ? dr : dr ? `injected q=${dr.quotes} c=${dr.contacts}` : 'not-swept',
    });
  }
  rows.sort((a, b) => a.claimedAt - b.claimedAt);

  console.log(`\n=== ${rows.length} claimed reclaims, oldest first ===\n`);
  for (const r of rows) {
    const ca = r.claimedAt ? new Date(r.claimedAt).toISOString().slice(0, 16) : '—';
    const ra = r.restoredAt ? new Date(r.restoredAt).toISOString().slice(0, 16) : '—';
    console.log(`  ${r.email}  claimed ${ca}  restored ${ra}  ${r.outcome}`);
  }

  const now = Date.now();
  const newest = rows.length ? Math.max(...rows.map((r) => r.claimedAt)) : 0;
  console.log(`\n  most recent claim: ${newest ? `${Math.round((now - newest) / 86400000)} days ago` : 'never'}`);

  // Signup trend for context: are ANY new users still arriving?
  const users = await db.collection('users').get();
  let last30 = 0;
  for (const u of users.docs) {
    const created = tsToMs(u.data().createdAt);
    if (created && now - created < 30 * 86400000) last30++;
  }
  console.log(`  total users: ${users.size} | signed up in last 30 days: ${last30}`);

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
