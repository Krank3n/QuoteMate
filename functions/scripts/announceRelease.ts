/**
 * Announce a released version to the in-app update sheet.
 *
 *   npm run release:announce -- --version 1.55 --whats-new "Quote reminders now..."
 *   npm run release:announce -- --version 1.55 --whats-new "..." --write
 *
 * Writes config/appUpdate, which src/services/appUpdateService.ts reads to
 * decide whether to show AppUpdateSheet.
 *
 * --version is the version LIVE IN THE STORES and is always explicit. Nothing
 * in the repo holds that number: app.config.js is bumped ahead of the store the
 * moment the next build needs its own OTA runtime (it read 1.56 while 1.55 was
 * what people could download), and package.json is whatever last got synced.
 * Announcing either would send every user to a version they cannot install.
 * app.config.js is still read, as a sanity check: announcing a version the
 * source has never been built at is refused.
 *
 * RUN THIS AFTER THE BUILD IS LIVE IN THE STORES, not at build time. Announcing
 * a version still in review tells everyone to update to something they cannot
 * download yet.
 *
 * Dry run by default. Pass --write to actually commit the change.
 *
 * Flags:
 *   --version <version>    The version live in the stores (required)
 *   --whats-new "<text>"   Changelog shown in the sheet (required)
 *   --write                Perform the write (otherwise prints the plan)
 *   --minimum <version>    Set the force-update floor. Blocks everyone below it.
 *   --allow-downgrade      Permit moving latestVersion backwards (rollback)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import {
  extractAppVersion,
  planAnnouncement,
  AppUpdateConfig,
} from './announceRelease.helpers';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * Collect every token up to the next flag.
 *
 * `npm run x -- --whats-new "a b c"` reaches the script as one argv entry when
 * quoting survives and as three when it doesn't, depending on how the shell and
 * npm forward it. Joining makes a release note impossible to silently truncate
 * to its first word.
 */
function flagPhrase(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const words: string[] = [];
  for (let j = i + 1; j < process.argv.length; j++) {
    if (process.argv[j].startsWith('--')) break;
    words.push(process.argv[j]);
  }
  return words.length ? words.join(' ') : undefined;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const appConfigPath = path.join(repoRoot, 'app.config.js');
  const packageJsonPath = path.join(repoRoot, 'package.json');

  const appConfigVersion = extractAppVersion(fs.readFileSync(appConfigPath, 'utf8'));

  let packageVersion: string | undefined;
  try {
    packageVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
  } catch {
    // Advisory only.
  }

  const version = flag('version');
  if (!version || version.startsWith('--')) {
    console.error(
      '\n--version is required: pass the version that is LIVE in the stores.\n' +
      '\nThe repo cannot tell you that number —\n' +
      `  app.config.js:  ${appConfigVersion ?? '(unreadable)'}   (bumped ahead for the next build's OTA runtime)\n` +
      `  package.json:   ${packageVersion ?? '(unreadable)'}\n` +
      '\nCheck Play Console / App Store Connect, then:\n' +
      '  npm run release:announce -- --version <store version> --whats-new "..."\n'
    );
    process.exit(1);
  }

  const projectId = process.env.GCLOUD_PROJECT || 'hansendev';
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const ref = admin.firestore().doc('config/appUpdate');
  const snap = await ref.get();
  const currentConfig = (snap.exists ? snap.data() : null) as AppUpdateConfig | null;

  const plan = planAnnouncement({
    version,
    appConfigVersion: appConfigVersion ?? undefined,
    currentConfig,
    whatsNew: flagPhrase('whats-new') || '',
    minimumVersion: flag('minimum'),
    packageVersion,
    allowDowngrade: has('allow-downgrade'),
  });

  console.log(`\nproject:        ${projectId}`);
  console.log(`--version:      ${version}   (what clients will be told is latest)`);
  console.log(`app.config.js:  ${appConfigVersion ?? '(unreadable)'}`);
  console.log(`package.json:   ${packageVersion ?? '(unreadable)'}`);
  if (!appConfigVersion) {
    console.log('\n  WARNING: could not read a version from app.config.js; skipping the "never built" check.');
  }
  console.log(`\ncurrent config/appUpdate:`);
  console.log(currentConfig ? JSON.stringify(currentConfig, null, 2) : '  (missing)');
  console.log(`\nproposed:`);
  console.log(JSON.stringify(plan.next, null, 2));

  for (const w of plan.warnings) console.log(`\n  WARNING: ${w}`);
  for (const e of plan.errors) console.error(`\n  ERROR:   ${e}`);

  if (!plan.ok) {
    console.error('\nRefusing to write. Fix the errors above.\n');
    process.exit(1);
  }

  if (!has('write')) {
    console.log('\nDry run — nothing written. Re-run with --write to apply.\n');
    return;
  }

  await ref.set({
    ...plan.next,
    announcedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`\nWrote config/appUpdate. Clients below ${plan.next.latestVersion} will now see the update sheet.\n`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
