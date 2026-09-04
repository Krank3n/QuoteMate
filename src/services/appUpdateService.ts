/**
 * App Update Service
 * Checks Firestore for version info and determines if an update prompt is needed.
 *
 * Firestore document: config/appUpdate
 * Fields:
 *   latestVersion: string   – newest published version (e.g. "1.0.80")
 *   minimumVersion: string  – oldest version still allowed (e.g. "1.0.70")
 *   latestBuild:  { ios?, android? } – newest store BUILD of latestVersion
 *   minimumBuild: { ios?, android? } – oldest build of minimumVersion allowed
 *   whatsNew: string        – short changelog shown in the sheet
 *
 * Why builds matter as well as versions: two store releases can carry the
 * same version string. Android 1.56 shipped twice, as versionCode 171 and
 * 172, and only 172 can receive over-the-air updates — yet a 171 device
 * compared "1.56" against "1.56", read itself as current, and was never
 * prompted. Build numbers are per-platform sequences (iOS CFBundleVersion vs
 * Android versionCode), so they are stored per platform and only ever
 * consulted when the version strings are equal.
 *
 * Soft prompts are snoozed: "Maybe later" hides that version for
 * UPDATE_SNOOZE_MS, then it asks once more. A newer latestVersion resets the
 * snooze, and a force update (below minimumVersion) ignores it entirely.
 * Without this the sheet re-appeared on every cold start until the tradie
 * updated, which trains people to dismiss it without reading.
 */

import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import Constants from 'expo-constants';
import { currentAppBuild } from './appIdentity';

export interface AppUpdateInfo {
  /** Whether we should show any update prompt */
  updateAvailable: boolean;
  /** True = must update, cannot dismiss */
  forceUpdate: boolean;
  /** The latest version string */
  latestVersion: string;
  /** The latest store build of that version on this platform, when known. */
  latestBuild: number | null;
  /** Short changelog */
  whatsNew: string;
}

/** Per-platform store build numbers, as config/appUpdate stores them. */
export interface StoreBuilds {
  ios?: number;
  android?: number;
}

export interface AppUpdateConfig {
  latestVersion?: string;
  minimumVersion?: string;
  latestBuild?: StoreBuilds;
  minimumBuild?: StoreBuilds;
  whatsNew?: string;
}

/** What "Maybe later" records: which release was declined, and when. */
export interface UpdateSnooze {
  /** Release key — version, plus the build when the config named one. */
  version: string;
  dismissedAt: number;
}

/**
 * The identity a snooze is keyed on. Including the build means declining
 * 1.56 (171) does not also silence the later 1.56 (172).
 */
export function releaseKey(version: string, build: number | null): string {
  return build === null ? version : `${version}+${build}`;
}

/** A build number as the platform reports it; null when it isn't a number. */
export function parseBuild(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.trunc(raw) : null;
  if (typeof raw !== 'string') return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compare one release against another: version first, then build as the
 * tie-break. A missing build on either side means the versions decide,
 * which keeps a config written before builds existed behaving as it did.
 */
export function compareRelease(
  a: { version: string; build: number | null },
  b: { version: string; build: number | null },
): number {
  const byVersion = compareVersions(a.version, b.version);
  if (byVersion !== 0) return byVersion;
  if (a.build === null || b.build === null) return 0;
  return a.build === b.build ? 0 : a.build < b.build ? -1 : 1;
}

/** How long "Maybe later" keeps a soft prompt quiet. */
export const UPDATE_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

const SNOOZE_KEY = '@quotemate:app_update_snooze';

/** Compare two semver-style version strings. Returns -1 / 0 / 1. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * Whether a stored snooze still silences this prompt.
 *
 * A dismissal in the future is treated as no snooze rather than honoured: a
 * device whose clock was wrong when "Maybe later" was tapped must not stay
 * quiet for years once the clock is corrected.
 */
export function isSnoozed(
  info: AppUpdateInfo,
  snooze: UpdateSnooze | null,
  now: number,
): boolean {
  if (info.forceUpdate) return false;
  if (!snooze || snooze.version !== releaseKey(info.latestVersion, info.latestBuild)) return false;
  const elapsed = now - snooze.dismissedAt;
  return elapsed >= 0 && elapsed < UPDATE_SNOOZE_MS;
}

export async function readUpdateSnooze(): Promise<UpdateSnooze | null> {
  try {
    const raw = await AsyncStorage.getItem(SNOOZE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.version === 'string' &&
      typeof parsed.dismissedAt === 'number' &&
      Number.isFinite(parsed.dismissedAt)
    ) {
      return { version: parsed.version, dismissedAt: parsed.dismissedAt };
    }
    return null;
  } catch {
    return null;
  }
}

/** Record "Maybe later" for a release. Fire-and-forget safe. */
export async function snoozeUpdate(version: string, now: number = Date.now()): Promise<void> {
  try {
    const snooze: UpdateSnooze = { version, dismissedAt: now };
    await AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify(snooze));
  } catch {
    // A failed write only means one extra prompt next launch.
  }
}

/**
 * Whether this build is behind what the stores hold. Pure, so the version and
 * build arithmetic is testable without Firestore or a device.
 */
export function decideUpdate(args: {
  currentVersion: string;
  currentBuild: number | null;
  platform: 'ios' | 'android' | string;
  config: AppUpdateConfig;
}): AppUpdateInfo | null {
  const { currentVersion, currentBuild, platform, config } = args;
  const buildFor = (builds: StoreBuilds | undefined): number | null => {
    if (!builds) return null;
    const raw = platform === 'ios' ? builds.ios : platform === 'android' ? builds.android : undefined;
    return parseBuild(raw);
  };

  const latest = { version: config.latestVersion ?? currentVersion, build: buildFor(config.latestBuild) };
  const minimum = { version: config.minimumVersion ?? '0.0.0', build: buildFor(config.minimumBuild) };
  const current = { version: currentVersion, build: currentBuild };

  if (compareRelease(current, latest) >= 0) return null;

  return {
    updateAvailable: true,
    forceUpdate: compareRelease(current, minimum) < 0,
    latestVersion: latest.version,
    latestBuild: latest.build,
    whatsNew: config.whatsNew ?? '',
  };
}

export async function checkForUpdate(now: number = Date.now()): Promise<AppUpdateInfo | null> {
  try {
    const snap = await getDoc(doc(db, 'config', 'appUpdate'));
    if (!snap.exists()) return null;

    // The store build this device is running — the only way to tell two
    // releases of the same version apart — and the platform whose build
    // sequence it belongs to. Both from one source: services/appIdentity.
    const running = currentAppBuild();
    const info = decideUpdate({
      currentVersion: Constants.expoConfig?.version ?? '0.0.0',
      currentBuild: parseBuild(running.build),
      platform: running.platform,
      config: snap.data() as AppUpdateConfig,
    });
    if (!info) return null;

    if (isSnoozed(info, await readUpdateSnooze(), now)) return null;

    return info;
  } catch {
    // Never block the app on a failed update check
    return null;
  }
}
