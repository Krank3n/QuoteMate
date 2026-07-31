/**
 * Read-only funnel pull + never-quoted cohort breakdown.
 *
 *   cd functions && npx ts-node scripts/funnelBreakdown.ts
 *
 * Runs the same signup → trial → sent → paying funnel as the adminFunnelStats
 * callable (reusing computeFunnelStats), then digs into the cohort the
 * dashboard can't explain: users who never started a quote. Splits them by
 * test accounts, whether they ever came back after signup day, whether they
 * completed the business profile, and whether they talked to Mate — so we can
 * tell "never opened the app again" from "opened it and stalled".
 *
 * Needs Application Default Credentials. Makes no writes.
 */
import * as admin from 'firebase-admin';
import {
  computeFunnelStats,
  FunnelUserInput,
  isActivatingDoc,
  isTestAccount,
} from '../src/adminFunnel.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;


function ts(v: any): number | null {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';
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

  // Same joins as computeFunnelPayload in adminCrm.ts.
  const authUsers: admin.auth.UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    authUsers.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  const [profileSnap, settingsSnap, docsSnap, convSnap] = await Promise.all([
    db.collectionGroup('profile').get(),
    db.collectionGroup('settings').get(),
    db.collectionGroup('documents').get(),
    db.collectionGroup('assistantConversations').get(),
  ]);

  const subs = new Map<string, any>();
  for (const d of profileSnap.docs) {
    if (d.id !== 'subscription') continue;
    const uid = d.ref.parent.parent?.id;
    if (uid) subs.set(uid, d.data());
  }

  const emailStates = new Map<string, any>();
  const hasBusinessDoc = new Set<string>();
  for (const d of settingsSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    if (d.id === 'emailState') emailStates.set(uid, d.data());
    if (d.id === 'business') hasBusinessDoc.add(uid);
  }

  const activatedUids = new Set<string>();
  const hasAnyDoc = new Set<string>();
  for (const d of docsSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    hasAnyDoc.add(uid);
    if (isActivatingDoc(d.data() as any)) activatedUids.add(uid);
  }

  const hasMateChat = new Set<string>();
  for (const d of convSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (uid) hasMateChat.add(uid);
  }

  const inputs: FunnelUserInput[] = authUsers.map((u) => {
    const es = emailStates.get(u.uid) || {};
    return {
      uid: u.uid,
      email: u.email || null,
      businessName: u.displayName || null,
      sub: subs.get(u.uid) || null,
      signupAt: ts(es.signupAt) || new Date(u.metadata.creationTime).getTime(),
      lastActivityAt: ts(es.lastActivityAt),
      hasSentDoc: activatedUids.has(u.uid),
    };
  });

  // ---- 1. The official funnel, exactly as the dashboard computes it ----
  const payload = computeFunnelStats(inputs, now);
  const f = payload.funnel;
  console.log('=== FUNNEL (all-time, same math as /admin/analytics) ===');
  console.log(`signups        ${f.signups}`);
  console.log(`startedTrial   ${f.startedTrial}  (${pct(f.startedTrial, f.signups)} of signups)`);
  console.log(`sentQuote      ${f.sentQuote}  (${pct(f.sentQuote, f.startedTrial)} of trials)`);
  console.log(`paying         ${f.paying}  (billed ${f.payingBilled} + restored ${f.payingRestored})`);
  console.log(`trial→paid     ${pct(f.paying, f.startedTrial)}   activation ${pct(f.sentQuote, f.signups)}`);

  // ---- 2. Never-started-a-quote cohort breakdown ----
  for (const windowDays of [30, null] as (number | null)[]) {
    const label = windowDays ? `signed up in last ${windowDays}d` : 'all-time';
    const cohort = authUsers.filter((u) => {
      const es = emailStates.get(u.uid) || {};
      const signupAt = ts(es.signupAt) || new Date(u.metadata.creationTime).getTime();
      const sub = subs.get(u.uid);
      const noTrial = !sub?.trialStartedAt;
      const inWindow = windowDays === null || now - signupAt <= windowDays * DAY_MS;
      return noTrial && !hasAnyDoc.has(u.uid) && inWindow;
    });

    const isTest = (u: admin.auth.UserRecord) => isTestAccount(u.email, u.displayName);
    const test = cohort.filter(isTest);
    const real = cohort.filter((u) => !isTest(u));

    let neverReturned = 0;
    let onboardedStalled = 0;
    let returnedNoOnboarding = 0;
    let triedMate = 0;
    const rows: string[] = [];

    for (const u of real) {
      const es = emailStates.get(u.uid) || {};
      const signupAt = ts(es.signupAt) || new Date(u.metadata.creationTime).getTime();
      const lastActivityAt = ts(es.lastActivityAt);
      // "Came back" = activity ping more than a day after signup.
      const cameBack = lastActivityAt !== null && lastActivityAt - signupAt > DAY_MS;
      const onboarded = hasBusinessDoc.has(u.uid);
      const mate = hasMateChat.has(u.uid);

      if (mate) triedMate++;
      if (!cameBack && !onboarded) neverReturned++;
      else if (onboarded) onboardedStalled++;
      else returnedNoOnboarding++;

      rows.push(
        `  ${(u.displayName || u.email || u.uid).slice(0, 38).padEnd(40)}` +
          `signup ${days(signupAt, now).padEnd(9)} lastActive ${days(lastActivityAt, now).padEnd(9)}` +
          `${onboarded ? ' onboarded' : ''}${mate ? ' mate-chat' : ''}` +
          `${es.appPlatform ? ` ${es.appPlatform}` : ''}${es.appVersion ? `@${es.appVersion}` : ''}`,
      );
    }

    console.log(`\n=== NEVER STARTED A QUOTE — ${label} ===`);
    console.log(`total ${cohort.length}  (test accounts ${test.length}, real ${real.length})`);
    console.log(`  never returned after signup day, no onboarding: ${neverReturned}`);
    console.log(`  completed business profile but no quote:        ${onboardedStalled}`);
    console.log(`  came back after signup but never onboarded:     ${returnedNoOnboarding}`);
    console.log(`  talked to Mate but never made a quote:          ${triedMate}`);
    if (windowDays) {
      console.log(`\nPer-user (real accounts, ${label}):`);
      rows.forEach((r) => console.log(r));
    }
  }

  // ---- 3. Sanity: trial-with-0-docs (tapped New Quote, never saved) ----
  const tappedNeverSaved = authUsers.filter((u) => {
    const sub = subs.get(u.uid);
    return !!sub?.trialStartedAt && !hasAnyDoc.has(u.uid);
  }).length;
  console.log(`\nStarted trial (tapped New Quote) but 0 saved docs: ${tappedNeverSaved}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
