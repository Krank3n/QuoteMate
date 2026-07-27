#!/usr/bin/env node
/**
 * Onboarding step drop-off report.
 *
 * Reads the durable progress mirror written by
 * firestoreService.saveOnboardingProgress (users/{uid}/profile/onboarding) and
 * answers the question the funnel could not answer before it existed: WHICH
 * STEP loses the signups who never finish onboarding, and on which platform.
 *
 * A user with `isOnboarded != true` and a `lastStepKey` walked away at that
 * step. Users with no progress fields at all signed up before the
 * instrumentation shipped (2026-07-27) and are reported separately rather than
 * silently folded in — they'd otherwise look like step-1 abandonments.
 *
 * Read-only. Uses application-default credentials:
 *   gcloud auth application-default login
 *   node scripts/onboarding-dropoff.js [--days 30]
 */
const admin = require('../functions/node_modules/firebase-admin');

const DAY = 86400000;
const argv = process.argv.slice(2);
const daysArg = argv.indexOf('--days');
const WINDOW_DAYS = daysArg !== -1 ? Number(argv[daysArg + 1]) : 30;

admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'hansendev' });
const db = admin.firestore();
const auth = admin.auth();

async function listAllUsers() {
  const out = [];
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      out.push({
        uid: u.uid,
        signup: u.metadata.creationTime ? new Date(u.metadata.creationTime).getTime() : null,
      });
    }
    pageToken = res.pageToken;
  } while (pageToken);
  return out;
}

const safeGet = async (path) => {
  try {
    const snap = await db.doc(path).get();
    return snap.exists ? snap.data() : null;
  } catch {
    return null;
  }
};

async function main() {
  const now = Date.now();
  const users = await listAllUsers();
  const rows = [];

  for (let i = 0; i < users.length; i += 25) {
    const batch = users.slice(i, i + 25);
    rows.push(
      ...(await Promise.all(
        batch.map(async (u) => {
          const [onboarding, reg] = await Promise.all([
            safeGet(`users/${u.uid}/profile/onboarding`),
            safeGet(`users/${u.uid}/settings/registrationInfo`),
          ]);
          return {
            ...u,
            isOnboarded: onboarding?.isOnboarded === true,
            lastStepKey: onboarding?.lastStepKey || null,
            lastStepIndex: onboarding?.lastStepIndex ?? null,
            stepsTotal: onboarding?.stepsTotal ?? null,
            platform: reg?.platform || 'unknown',
          };
        }),
      )),
    );
    process.stderr.write('.');
  }
  process.stderr.write('\n');

  const cohort = rows.filter((r) => r.signup && now - r.signup < WINDOW_DAYS * DAY);
  const finished = cohort.filter((r) => r.isOnboarded);
  const unfinished = cohort.filter((r) => !r.isOnboarded);
  const tracked = unfinished.filter((r) => r.lastStepKey);
  const untracked = unfinished.filter((r) => !r.lastStepKey);

  const pct = (x, of) => (of ? `${((x / of) * 100).toFixed(0)}%` : '—');

  console.log(`\n=== ONBOARDING, LAST ${WINDOW_DAYS} DAYS (n=${cohort.length}) ===`);
  console.log(`  finished:    ${finished.length} (${pct(finished.length, cohort.length)})`);
  console.log(`  unfinished:  ${unfinished.length} (${pct(unfinished.length, cohort.length)})`);
  if (untracked.length) {
    console.log(`    of which pre-instrumentation (no progress recorded): ${untracked.length}`);
  }

  if (!tracked.length) {
    console.log('\n  No tracked abandonments yet — the mirror only covers signups');
    console.log('  from 2026-07-27 onward. Re-run once a fresh cohort has flowed through.');
    return;
  }

  console.log(`\n=== WHERE THE ${tracked.length} UNFINISHED USERS STOPPED ===`);
  const byStep = new Map();
  for (const r of tracked) {
    const entry = byStep.get(r.lastStepKey) || { n: 0, index: r.lastStepIndex, platforms: {} };
    entry.n++;
    entry.platforms[r.platform] = (entry.platforms[r.platform] || 0) + 1;
    byStep.set(r.lastStepKey, entry);
  }
  [...byStep.entries()]
    .sort((a, b) => (a[1].index ?? 99) - (b[1].index ?? 99))
    .forEach(([key, e]) => {
      const bar = '█'.repeat(Math.round((e.n / tracked.length) * 30));
      const plats = Object.entries(e.platforms)
        .sort((a, b) => b[1] - a[1])
        .map(([p, c]) => `${p}:${c}`)
        .join(' ');
      console.log(
        `  ${String(e.index ?? '?').padStart(2)}. ${key.padEnd(11)} ${String(e.n).padStart(3)} ${pct(e.n, tracked.length).padStart(4)} ${bar}  ${plats}`,
      );
    });

  console.log('\n=== COMPLETION BY PLATFORM ===');
  const byPlatform = new Map();
  for (const r of cohort) {
    const entry = byPlatform.get(r.platform) || { n: 0, done: 0 };
    entry.n++;
    if (r.isOnboarded) entry.done++;
    byPlatform.set(r.platform, entry);
  }
  [...byPlatform.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .forEach(([p, e]) =>
      console.log(`  ${p.padEnd(9)} n=${String(e.n).padStart(3)}  finished ${String(e.done).padStart(3)} ${pct(e.done, e.n).padStart(4)}`),
    );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
