/**
 * Archive one or more Xero contacts via the Xero Contacts API. Xero doesn't
 * permit hard-delete, so archiving is the equivalent — the contacts stop
 * appearing in pickers and our search-by-name skips them.
 *
 * Usage:
 *   # dry run (default):
 *   npx ts-node scripts/archiveXeroContacts.ts <uid> <contactId>[,<contactId>...]
 *   # actually archive:
 *   npx ts-node scripts/archiveXeroContacts.ts <uid> <contactId>[,<contactId>...] --commit
 */
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { buildXeroAuthHeaders } from '../src/xeroSync';

async function getTokens(uid: string) {
  const db = admin.firestore();
  const snap = await db.doc(`users/${uid}/settings/xeroConnection`).get();
  if (!snap.exists) throw new Error('No Xero connection');
  const d = snap.data() as any;
  if (d.tokenExpiresAt && d.tokenExpiresAt > Date.now() + 60_000) {
    return { accessToken: d.accessToken, tenantId: d.tenantId };
  }
  const cid = process.env.XERO_CLIENT_ID;
  const cs = process.env.XERO_CLIENT_SECRET || process.env.XERO_SECRET;
  if (!cid || !cs) throw new Error('XERO_CLIENT_ID/SECRET env not set');
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${cid}:${cs}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.refreshToken }).toString(),
  });
  if (!res.ok) throw new Error('refresh failed: ' + (await res.text()));
  const t: any = await res.json();
  await db.doc(`users/${uid}/settings/xeroConnection`).update({
    accessToken: t.access_token,
    tokenExpiresAt: Date.now() + (t.expires_in || 1800) * 1000,
    ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
  });
  return { accessToken: t.access_token, tenantId: d.tenantId };
}

async function main() {
  const uid = process.argv[2];
  const idsArg = process.argv[3];
  const commit = process.argv.includes('--commit');
  if (!uid || !idsArg) {
    console.error('Usage: npx ts-node scripts/archiveXeroContacts.ts <uid> <contactId>[,<contactId>...] [--commit]');
    process.exit(1);
  }
  const contactIds = idsArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (contactIds.length === 0) {
    console.error('No contact ids');
    process.exit(1);
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });

  const { accessToken, tenantId } = await getTokens(uid);
  const headers = buildXeroAuthHeaders(accessToken, tenantId);

  console.log(`\nUser: ${uid}`);
  console.log(`Contacts to archive: ${contactIds.length}`);
  for (const id of contactIds) console.log(`  - ${id}`);

  if (!commit) {
    console.log(`\nDry run — pass --commit to actually archive.`);
    return;
  }

  for (const id of contactIds) {
    const url = `https://api.xero.com/api.xro/2.0/Contacts/${id}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ContactStatus: 'ARCHIVED' }),
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`\n✓ Archived ${id}`);
    } else {
      console.log(`\n✗ Failed ${id} (status=${res.status}):`);
      console.log(text.slice(0, 2000));
    }
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
