/**
 * Read-only: why do users stall at JobPreview with a finished quote?
 *
 *   cd functions && npx ts-node scripts/jobPreviewStallAnalysis.ts
 *
 * Follow-up to selfSendAnalysis.ts (Jul 2026), which found 35 of 83
 * never-senders parked at JobPreview. Candidate causes, checked per user:
 *
 *   - gate?      Free-tier send gate demands a Square connection, but ONLY
 *                after the 14-day trial (pro/trial skip it — see
 *                quoteDeliveryGuard.ensureCanDeliver). So: was the trial
 *                active when they last touched the stalled quote?
 *   - no contact? Quote has no customerEmail and no customerPhone — the
 *                email/SMS paths are dead ends (share/PDF still work).
 *   - engaged send? acceptanceTokenCreatedAt on a draft = they opened the
 *                send flow far enough to fire a test send.
 *   - failed send? emailLog rows for the user (status error/blocked).
 *   - gate events? users/{uid}/events send_gate_* rows (recent
 *                instrumentation — older stalls predate it).
 *   - test-looking? $0 or tiny totals, placeholder-ish customer names.
 *
 * Needs Application Default Credentials. Makes no writes.
 */
import * as admin from 'firebase-admin';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_MS = 14 * DAY_MS; // mirrors src/utils/trialConfig.ts
const TEST_ACCOUNT_RE = /example\.com$|mate\.debug|newtestuser|testuser@|^qm-marketing-demo$/i;

function ts(v: any): number | null {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function days(msEpoch: number | null, now: number): string {
  if (msEpoch === null) return 'never';
  return `${Math.floor((now - msEpoch) / DAY_MS)}d ago`;
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();
  const now = Date.now();

  const authUsers: admin.auth.UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    authUsers.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  const authByUid = new Map(authUsers.map((u) => [u.uid, u]));

  const [quotesSnap, profileSnap, settingsSnap, eventsSnap, emailLogSnap] = await Promise.all([
    db.collectionGroup('quotes').get(),
    db.collectionGroup('profile').get(),
    db.collectionGroup('settings').get(),
    db.collectionGroup('events').get(),
    db.collection('emailLog').get(),
  ]);

  const subs = new Map<string, any>();
  for (const d of profileSnap.docs) {
    if (d.id !== 'subscription') continue;
    const uid = d.ref.parent.parent?.id;
    if (uid) subs.set(uid, d.data());
  }
  const emailStates = new Map<string, any>();
  for (const d of settingsSnap.docs) {
    if (d.id !== 'emailState') continue;
    const uid = d.ref.parent.parent?.id;
    if (uid) emailStates.set(uid, d.data());
  }

  const gateEventsByUid = new Map<string, Record<string, number>>();
  for (const d of eventsSnap.docs) {
    const data = d.data();
    if (!String(data.event || '').startsWith('send_gate')) continue;
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    const rec = gateEventsByUid.get(uid) || {};
    rec[data.event] = (rec[data.event] || 0) + 1;
    gateEventsByUid.set(uid, rec);
  }

  const emailLogByUid = new Map<string, Record<string, number>>();
  for (const d of emailLogSnap.docs) {
    const data = d.data();
    if (!data.userId) continue;
    const key = `${data.category || 'unknown'}:${data.status || 'unknown'}`;
    const rec = emailLogByUid.get(data.userId) || {};
    rec[key] = (rec[key] || 0) + 1;
    emailLogByUid.set(data.userId, rec);
  }

  const quotesByUid = new Map<string, any[]>();
  for (const d of quotesSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    if (!quotesByUid.has(uid)) quotesByUid.set(uid, []);
    quotesByUid.get(uid)!.push(d.data());
  }

  // The cohort: real users, never sent anything, ≥1 draft at JobPreview.
  type Row = {
    name: string;
    stalledAt: number | null;
    trial: string;
    gateAtStall: boolean;
    hasEmail: boolean;
    hasPhone: boolean;
    testSend: boolean;
    total: number;
    customer: string;
    platform: string;
    lastActive: number | null;
    gateEvents: Record<string, number>;
    emailLog: Record<string, number>;
  };
  const rows: Row[] = [];

  for (const [uid, quotes] of quotesByUid) {
    const u = authByUid.get(uid);
    if (!u) continue;
    if (TEST_ACCOUNT_RE.test(u.email || '') || TEST_ACCOUNT_RE.test(u.displayName || '')) continue;

    const sentAny = quotes.some(
      (q) => q.status === 'sent' || q.status === 'accepted' || q.status === 'completed',
    );
    if (sentAny) continue;

    const previewDrafts = quotes
      .filter((q) => q.status === 'draft' && q.draftStep === 'JobPreview')
      .sort((a, b) => (ts(b.updatedAt) || 0) - (ts(a.updatedAt) || 0));
    if (previewDrafts.length === 0) continue;

    const q = previewDrafts[0];
    const stalledAt = ts(q.updatedAt);
    const sub = subs.get(uid);
    const trialStart = ts(sub?.trialStartedAt);
    let trial: string;
    let gateAtStall = false;
    if (!trialStart) {
      trial = 'no trial';
      gateAtStall = true; // free tier from day one → gate applies
    } else if (stalledAt !== null && stalledAt <= trialStart + TRIAL_MS) {
      trial = 'IN TRIAL at stall';
    } else {
      trial = `trial expired ${days(trialStart + TRIAL_MS, now)}`;
      gateAtStall = true;
    }

    const es = emailStates.get(uid) || {};
    rows.push({
      name: (u.displayName || u.email || uid).slice(0, 30),
      stalledAt,
      trial,
      gateAtStall,
      hasEmail: !!String(q.customerEmail || '').trim(),
      hasPhone: !!String(q.customerPhone || '').trim(),
      testSend: !!q.acceptanceTokenCreatedAt,
      total: Number(q.total || 0),
      customer: String(q.customerName || '').slice(0, 20),
      platform: `${es.appPlatform || '?'}${es.appVersion ? `@${es.appVersion}` : ''}`,
      lastActive: ts(es.lastActivityAt),
      gateEvents: gateEventsByUid.get(uid) || {},
      emailLog: emailLogByUid.get(uid) || {},
    });
  }

  rows.sort((a, b) => (b.stalledAt || 0) - (a.stalledAt || 0));

  const inTrial = rows.filter((r) => r.trial === 'IN TRIAL at stall');
  const gated = rows.filter((r) => r.gateAtStall);
  const noContact = rows.filter((r) => !r.hasEmail && !r.hasPhone);
  const testSends = rows.filter((r) => r.testSend);
  const zeroish = rows.filter((r) => r.total < 50);
  const sawGate = rows.filter((r) => Object.keys(r.gateEvents).length > 0);
  const emailAttempts = rows.filter((r) => Object.keys(r.emailLog).length > 0);

  console.log(`=== JOBPREVIEW STALLERS — ${rows.length} users ===\n`);
  console.log(`in trial when they stalled (NO gate in their way):  ${inTrial.length}`);
  console.log(`gate applied at stall (expired/no trial):           ${gated.length}`);
  console.log(`no customerEmail AND no customerPhone on the quote: ${noContact.length}`);
  console.log(`did a test send (engaged the send flow):            ${testSends.length}`);
  console.log(`quote total < $50 (test-looking):                   ${zeroish.length}`);
  console.log(`have send_gate_* events (recent instrumentation):   ${sawGate.length}`);
  console.log(`have any emailLog rows (delivery attempts):         ${emailAttempts.length}`);

  console.log('\n=== PER-USER ===');
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(32)} stalled ${days(r.stalledAt, now).padEnd(8)} ${r.trial.padEnd(24)}` +
        ` $${String(Math.round(r.total)).padStart(6)}  email:${r.hasEmail ? 'Y' : '-'} phone:${r.hasPhone ? 'Y' : '-'}` +
        ` testSend:${r.testSend ? 'Y' : '-'}  cust:"${r.customer}"  ${r.platform}  lastActive ${days(r.lastActive, now)}` +
        `${Object.keys(r.gateEvents).length ? `  gate:${JSON.stringify(r.gateEvents)}` : ''}` +
        `${Object.keys(r.emailLog).length ? `  emailLog:${JSON.stringify(r.emailLog)}` : ''}`,
    );
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
