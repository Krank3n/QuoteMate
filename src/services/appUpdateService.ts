/**
 * App Update Service
 * Checks Firestore for version info and determines if an update prompt is needed.
 *
 * Firestore document: config/appUpdate
 * Fields:
 *   latestVersion: string   – newest published version (e.g. "1.0.80")
 *   minimumVersion: string  – oldest version still allowed (e.g. "1.0.70")
 *   whatsNew: string        – short changelog shown in the sheet
 */

import { doc, getDoc } from 'firebase/firestore';
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

export async function checkForUpdate(): Promise<AppUpdateInfo | null> {
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

    return {
      updateAvailable: true,
      forceUpdate: belowMinimum,
      latestVersion: latest,
      whatsNew,
    };
  } catch {
    // Never block the app on a failed update check
    return null;
  }
}
