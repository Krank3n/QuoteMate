/**
 * App Update Service
 * Checks Firestore for version info and determines if an update prompt is needed.
 *
 * Firestore document: config/appUpdate
 * Fields:
 *   latestVersion: string   – newest published version (e.g. "1.0.80")
 *   minimumVersion: string  – oldest version still allowed (e.g. "1.0.70")
 *   whatsNew: string        – short changelog shown in the sheet
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

export interface AppUpdateInfo {
  /** Whether we should show any update prompt */
  updateAvailable: boolean;
  /** True = must update, cannot dismiss */
  forceUpdate: boolean;
  /** The latest version string */
  latestVersion: string;
  /** Short changelog */
  whatsNew: string;
}

/** What "Maybe later" records: which version was declined, and when. */
export interface UpdateSnooze {
  version: string;
  dismissedAt: number;
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
  if (!snooze || snooze.version !== info.latestVersion) return false;
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

/** Record "Maybe later" for a version. Fire-and-forget safe. */
export async function snoozeUpdate(version: string, now: number = Date.now()): Promise<void> {
  try {
    const snooze: UpdateSnooze = { version, dismissedAt: now };
    await AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify(snooze));
  } catch {
    // A failed write only means one extra prompt next launch.
  }
}

export async function checkForUpdate(now: number = Date.now()): Promise<AppUpdateInfo | null> {
  try {
    const currentVersion = Constants.expoConfig?.version ?? '0.0.0';
    const snap = await getDoc(doc(db, 'config', 'appUpdate'));

    if (!snap.exists()) return null;

    const data = snap.data() as {
      latestVersion?: string;
      minimumVersion?: string;
      whatsNew?: string;
    };

    const latest = data.latestVersion ?? currentVersion;
    const minimum = data.minimumVersion ?? '0.0.0';
    const whatsNew = data.whatsNew ?? '';

    const behindLatest = compareVersions(currentVersion, latest) < 0;
    const belowMinimum = compareVersions(currentVersion, minimum) < 0;

    if (!behindLatest) return null;

    const info: AppUpdateInfo = {
      updateAvailable: true,
      forceUpdate: belowMinimum,
      latestVersion: latest,
      whatsNew,
    };

    if (isSnoozed(info, await readUpdateSnooze(), now)) return null;

    return info;
  } catch {
    // Never block the app on a failed update check
    return null;
  }
}
