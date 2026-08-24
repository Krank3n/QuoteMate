/**
 * Store funnel — daily install counts from both app stores into Firestore,
 * so the weekly digest (and eventually the admin dashboard) can see the step
 * between website store-clicks and app signups. Built to measure whether the
 * 2026-07-14 ASO overhaul moves installs.
 *
 * Sources:
 *  - Google Play: the Play Console stats export bucket
 *    (gs://pubsite_prod_rev_…/stats/installs/installs_<pkg>_<YYYYMM>_overview.csv,
 *    UTF-16LE CSVs, ~1 day lag). Access = invite the functions runtime SA
 *    (hansendev@appspot.gserviceaccount.com) in Play Console → Users and
 *    permissions with "View app information and download bulk reports".
 *  - Apple: App Store Connect GET /v1/salesReports (DAILY/SALES/SUMMARY,
 *    gzipped TSV, available ~afternoon Brisbane for the prior day). Auth = a
 *    team API key with the Sales role, signed locally as an ES256 JWT.
 *
 * Config via functions/.env — each side is skipped (with a log line) until
 * its credentials exist, so this deploys safely before the grants are done:
 *  PLAY_STATS_BUCKET   pubsite_prod_rev_XXXXXXXXXXXXXXXXXXXX
 *  ASC_KEY_ID          App Store Connect API key id
 *  ASC_ISSUER_ID       App Store Connect issuer id
 *  ASC_PRIVATE_KEY     .p8 contents, newlines escaped as \n
 *  ASC_VENDOR_NUMBER   from ASC → Payments and Financial Reports
 *
 * Output: storeStats/{YYYYMMDD} docs { date, playInstalls?, appleUnits?, updatedAt }.
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

const PLAY_PACKAGE = 'com.quotemate.app';
const APPLE_APP_ID = '6754000046';

// ---------- pure helpers (unit tested) ----------

/**
 * Parse a Play installs_overview CSV (already decoded to a JS string) into
 * date → daily user installs. Prefers "Daily User Installs", falls back to
 * "Daily Device Installs" if the column set ever changes.
 */
export function parsePlayInstallsCsv(csv: string, packageName: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return out;
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf('date');
  const pkgIdx = header.indexOf('package name');
  let installsIdx = header.indexOf('daily user installs');
  if (installsIdx === -1) installsIdx = header.indexOf('daily device installs');
  if (dateIdx === -1 || installsIdx === -1) return out;

  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    if (pkgIdx !== -1 && cols[pkgIdx]?.trim() !== packageName) continue;
    const date = cols[dateIdx]?.trim();
    const n = Number(cols[installsIdx]);
    if (date && Number.isFinite(n)) out.set(date, n);
  }
  return out;
}

/**
 * Sum first-time app download units from an Apple SALES/SUMMARY TSV.
 * Product Type Identifiers starting with "1" are app purchases/downloads
 * (1, 1F, 1T, 1E…); "7*" are updates and "IA*" in-app — excluded.
 */
export function parseAppleSalesReport(tsv: string, appleAppId: string): number {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return 0;
  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf('apple identifier');
  const typeIdx = header.indexOf('product type identifier');
  const unitsIdx = header.indexOf('units');
  if (idIdx === -1 || typeIdx === -1 || unitsIdx === -1) return 0;

  let units = 0;
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    if (cols[idIdx]?.trim() !== appleAppId) continue;
    if (!cols[typeIdx]?.trim().startsWith('1')) continue;
    const n = Number(cols[unitsIdx]);
    if (Number.isFinite(n)) units += n;
  }
  return units;
}

/** Build a short-lived ES256 JWT for the App Store Connect API. */
export function makeAscJwt(
  opts: { keyId: string; issuerId: string; privateKey: string },
  nowSec: number = Math.floor(Date.now() / 1000)
): string {
  const b64url = (buf: Buffer) => buf.toString('base64url');
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', kid: opts.keyId, typ: 'JWT' })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ iss: opts.issuerId, iat: nowSec, exp: nowSec + 15 * 60, aud: 'appstoreconnect-v1' })
    )
  );
  const signingInput = `${header}.${payload}`;
  // Apple requires the raw (r||s) signature form, not ASN.1/DER.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: opts.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${b64url(signature)}`;
}

/** YYYYMMDD / YYYY-MM-DD / YYYYMM for a Date, rendered in Brisbane time. */
export function brisbaneDateParts(d: Date): { compact: string; dashed: string; month: string } {
  const bris = new Date(d.getTime() + 10 * 60 * 60 * 1000); // AEST, no DST in QLD
  const iso = bris.toISOString().slice(0, 10);
  return { compact: iso.replace(/-/g, ''), dashed: iso, month: iso.slice(0, 7).replace('-', '') };
}

// ---------- fetchers ----------

async function fetchPlayInstallMap(bucket: string, yyyymm: string): Promise<Map<string, number> | null> {
  const path = `stats/installs/installs_${PLAY_PACKAGE}_${yyyymm}_overview.csv`;
  try {
    const [buf] = await admin.storage().bucket(bucket).file(path).download();
    // Play stats CSVs are UTF-16LE with a BOM.
    const text = buf.toString('utf16le');
    return parsePlayInstallsCsv(text, PLAY_PACKAGE);
  } catch (err: any) {
    console.warn(`storeFunnel: play download failed for ${path}: ${err?.message}`);
    return null;
  }
}

async function fetchAppleUnits(dateDashed: string): Promise<number | null> {
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  const privateKey = (process.env.ASC_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const vendor = process.env.ASC_VENDOR_NUMBER;
  if (!keyId || !issuerId || !privateKey || !vendor) return null;

  const jwt = makeAscJwt({ keyId, issuerId, privateKey });
  const params = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportDate]': dateDashed,
    'filter[reportSubType]': 'SUMMARY',
    'filter[reportType]': 'SALES',
    'filter[vendorNumber]': vendor,
  });
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${params}`, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/a-gzip' },
  });
  if (res.status === 404) return null; // report not generated yet — retry tomorrow
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.warn(`storeFunnel: ASC salesReports ${res.status} for ${dateDashed}: ${txt.slice(0, 200)}`);
    return null;
  }
  const gz = Buffer.from(await res.arrayBuffer());
  const tsv = zlib.gunzipSync(gz).toString('utf8');
  return parseAppleSalesReport(tsv, APPLE_APP_ID);
}

// ---------- scheduled job ----------

export const storeFunnelDaily = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .pubsub.schedule('every day 09:30')
  .timeZone('Australia/Brisbane')
  .onRun(async () => {
    const playBucket = process.env.PLAY_STATS_BUCKET || '';
    const ascConfigured = !!(process.env.ASC_KEY_ID && process.env.ASC_ISSUER_ID && process.env.ASC_PRIVATE_KEY && process.env.ASC_VENDOR_NUMBER);
    if (!playBucket) console.info('storeFunnel: PLAY_STATS_BUCKET not set — skipping Play side');
    if (!ascConfigured) console.info('storeFunnel: ASC_* not set — skipping Apple side');
    if (!playBucket && !ascConfigured) return null;

    // Both sources lag — Play's monthly overview CSV by up to ~5 days — so a
    // 4-day window could permanently miss days. Refresh a rolling 10-day
    // window; merge-writes make re-processing already-written days free.
    const days: { compact: string; dashed: string; month: string }[] = [];
    for (let back = 1; back <= 10; back++) {
      days.push(brisbaneDateParts(new Date(Date.now() - back * 24 * 60 * 60 * 1000)));
    }

    // Play: one CSV per month covers all days in that month.
    const playByDate = new Map<string, number>();
    if (playBucket) {
      const months = [...new Set(days.map((d) => d.month))];
      for (const m of months) {
        const map = await fetchPlayInstallMap(playBucket, m);
        for (const [date, n] of map || []) playByDate.set(date, n);
      }
    }

    const db = admin.firestore();
    let wrote = 0;
    for (const d of days) {
      const patch: Record<string, unknown> = { date: d.dashed, updatedAt: Date.now() };
      const play = playByDate.get(d.dashed);
      if (play !== undefined) patch.playInstalls = play;
      if (ascConfigured) {
        const units = await fetchAppleUnits(d.dashed);
        if (units !== null) patch.appleUnits = units;
      }
      if (patch.playInstalls === undefined && patch.appleUnits === undefined) continue;
      await db.collection('storeStats').doc(d.compact).set(patch, { merge: true });
      wrote++;
    }
    console.info(`storeFunnel: refreshed ${wrote}/${days.length} days (play=${playByDate.size} dates, asc=${ascConfigured})`);
    return null;
  });

/** Read the last `n` days of store stats, oldest→newest. Used by the digest. */
export async function readStoreStats(n: number): Promise<Array<{ date: string; playInstalls?: number; appleUnits?: number }>> {
  const snap = await admin
    .firestore()
    .collection('storeStats')
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
    .limit(n)
    .get();
  return snap.docs
    .map((d) => d.data() as any)
    .reverse()
    .map((d) => ({ date: d.date, playInstalls: d.playInstalls, appleUnits: d.appleUnits }));
}
