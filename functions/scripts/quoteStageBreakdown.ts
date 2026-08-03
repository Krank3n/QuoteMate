/**
 * Read-only: where in the quote wizard a signup cohort stops.
 *
 *   cd functions && npx ts-node scripts/quoteStageBreakdown.ts [days]
 *
 * The dashboard funnel shows the trial → sent collapse but not which screen it
 * happens on. This runs the same per-document stage classification the funnel
 * now uses (quoteStageOfDoc) over a signup cohort and prints both the
 * cumulative ladder and where each stalled user is parked.
 *
 * Needs Application Default Credentials. Makes no writes.
 */
import * as admin from 'firebase-admin';
import {
  isActivatingDoc,
  isRecoveredDocId,
  isTestAccount,
  maxQuoteStage,
  quoteStageOfDoc,
  quoteStageRank,
  QUOTE_STAGES,
  type QuoteStage,
} from '../src/adminFunnel.helpers';
import { deriveSubFields, isBilledSub } from '../src/subscription.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = Number(process.argv[2]) || 28;

function ts(v: any): number | null {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : '—');

async function main() {
  admin.initializeApp();
  const db = admin.firestore();
  const now = Date.now();
  const since = now - DAYS * DAY_MS;

  // Firestore only — the Auth Admin API needs a quota project that local ADC
  // doesn't carry, and settings/emailState already holds signupAt + email.
  const [profileSnap, settingsSnap, docsSnap] = await Promise.all([
    db.collectionGroup('profile').get(),
    db.collectionGroup('settings').get(),
    db.collectionGroup('documents').get(),
  ]);

  const subs = new Map<string, any>();
  for (const d of profileSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (uid && d.id === 'subscription') subs.set(uid, d.data());
  }
  const signupAts = new Map<string, number | null>();
  const emails = new Map<string, string | null>();
  for (const d of settingsSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid || d.id !== 'emailState') continue;
    signupAts.set(uid, ts(d.data()?.signupAt));
    emails.set(uid, d.data()?.email || null);
  }

  const stages = new Map<string, QuoteStage>();
  const sent = new Set<string>();
  let recoveredSkipped = 0;
  for (const d of docsSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    if (isRecoveredDocId(d.id)) { recoveredSkipped++; continue; }
    const data = d.data() as any;
    if (isActivatingDoc(data)) sent.add(uid);
    stages.set(uid, maxQuoteStage(stages.get(uid), quoteStageOfDoc(data)));
  }

  const cohort = Array.from(signupAts.entries())
    .filter(([uid, signupAt]) => signupAt !== null && signupAt >= since && !isTestAccount(emails.get(uid)))
    .map(([uid]) => ({ uid }));

  const parked: Record<string, number> = {};
  let startedTrial = 0;
  let paying = 0;
  const ladder: Record<string, number> = {};

  for (const u of cohort) {
    const sub = subs.get(u.uid) || null;
    if (deriveSubFields(sub, now).trialStartedAt !== null) startedTrial++;
    if (isBilledSub(sub)) paying++;
    const stage = maxQuoteStage(stages.get(u.uid), sent.has(u.uid) ? 'sent' : 'none');
    parked[stage] = (parked[stage] || 0) + 1;
    for (const s of QUOTE_STAGES) {
      if (quoteStageRank(stage) >= quoteStageRank(s)) ladder[s] = (ladder[s] || 0) + 1;
    }
  }

  console.log(`\nSignups in the last ${DAYS}d (excluding test accounts): ${cohort.length}`);
  console.log(`Started a trial: ${startedTrial}   Paying: ${paying}`);
  console.log(`(skipped ${recoveredSkipped} recovered- documents)\n`);

  console.log('CUMULATIVE — reached at least this screen:');
  let prev = startedTrial;
  for (const s of QUOTE_STAGES.slice(1)) {
    const n = ladder[s] || 0;
    console.log(`  ${s.padEnd(13)} ${String(n).padStart(4)}   ${pct(n, prev).padStart(4)} of previous   lost ${prev - n}`);
    prev = n;
  }

  console.log('\nPARKED — where each person actually stopped:');
  for (const s of QUOTE_STAGES) {
    const n = parked[s] || 0;
    if (n) console.log(`  ${s.padEnd(13)} ${String(n).padStart(4)}   ${pct(n, cohort.length)}`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
