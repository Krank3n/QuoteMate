/**
 * Which build of the app is running: store version, native build number,
 * platform, and the over-the-air update it launched with (if any).
 *
 * Attached to every logged Mate conversation so the admin panel can tell,
 * for any chat, exactly what code the tradie was on — the store version
 * alone can't, because an OTA changes the JavaScript without changing it.
 * Every read is guarded: none of these modules exist on web or in Expo Go,
 * and a missing one must never break a chat sync.
 */

import { Platform } from 'react-native';

export interface AppBuildIdentity {
  /** app.config.js → expo.version, e.g. "1.56". */
  version: string | null;
  /** Native build number (iOS CFBundleVersion / Android versionCode). */
  build: string | null;
  platform: string;
  /** EAS Update id the app launched with; null on the embedded bundle. */
  updateId: string | null;
  runtimeVersion: string | null;
  channel: string | null;
  /** ISO — when the running update was published. */
  updatedAt: string | null;
}

export interface AppIdentitySources {
  version(): string | null | undefined;
  build(): string | null | undefined;
  updates(): {
    updateId?: string | null;
    runtimeVersion?: string | null;
    channel?: string | null;
    createdAt?: Date | null;
    isEmbeddedLaunch?: boolean;
  } | null;
}

export function describeAppBuild(sources: AppIdentitySources, platform: string = Platform.OS): AppBuildIdentity {
  const safe = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  const updates = safe(() => sources.updates(), null);
  const embedded = !updates || updates.isEmbeddedLaunch === true;
  return {
    version: safe(() => sources.version(), null) || null,
    build: safe(() => sources.build(), null) || null,
    platform,
    updateId: embedded ? null : updates?.updateId || null,
    runtimeVersion: updates?.runtimeVersion || null,
    channel: updates?.channel || null,
    updatedAt: !embedded && updates?.createdAt instanceof Date ? updates.createdAt.toISOString() : null,
  };
}

/** Production sources — each module required lazily so a missing native part is just a null. */
export function deviceSources(): AppIdentitySources {
  return {
    version: () => require('expo-constants').default?.expoConfig?.version ?? null,
    build: () => require('expo-application').nativeBuildVersion ?? null,
    updates: () => {
      const u = require('expo-updates');
      return {
        updateId: u.updateId,
        runtimeVersion: u.runtimeVersion,
        channel: u.channel,
        createdAt: u.createdAt,
        isEmbeddedLaunch: u.isEmbeddedLaunch,
      };
    },
  };
}

let cached: AppBuildIdentity | null = null;

/** The running build, computed once per process. */
export function currentAppBuild(): AppBuildIdentity {
  if (!cached) cached = describeAppBuild(deviceSources());
  return cached;
}
