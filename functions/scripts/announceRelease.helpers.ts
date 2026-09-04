/**
 * Pure planning logic for the release announcement step.
 *
 * `config/appUpdate` drives the in-app update sheet (src/services/
 * appUpdateService.ts). It went stale at "1.0.74" while the app shipped 1.54,
 * and because the client compares versions positionally, clients read as NEWER
 * than "latest" and the sheet silently never rendered. Nobody noticed, because
 * a dead update prompt looks exactly like a released-and-up-to-date one.
 *
 * The version announced is the one LIVE IN THE STORES, passed explicitly.
 * Neither file in the repo is that number: app.config.js is bumped ahead of
 * the store as soon as the next build needs a fresh OTA runtime (1.56 while
 * 1.55 was still what people could download), and package.json is whatever
 * last got synced. Reading either would announce a version nobody can get.
 *
 * Everything here is pure so the guards that prevent a repeat are testable.
 */

/** Per-platform store build numbers (iOS CFBundleVersion, Android versionCode). */
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

export interface AnnounceInput {
  /** The version live in the stores — the value latestVersion becomes. */
  version: string;
  /**
   * Version from app.config.js, advisory. It is legitimately AHEAD of the
   * store between a bump and the next store release; it can never be behind
   * a version that shipped, so that direction is refused.
   */
  appConfigVersion?: string;
  /** Existing config/appUpdate, or null when the doc is missing. */
  currentConfig: AppUpdateConfig | null;
  whatsNew: string;
  /** Only ever set deliberately: this force-updates everyone below it. */
  minimumVersion?: string;
  /**
   * Store build numbers of THIS version, per platform. They matter because a
   * version string is not unique: Android shipped 1.56 as versionCode 171 and
   * again as 172, and only 172 could take an over-the-air update — but a 171
   * device compared "1.56" to "1.56" and was never prompted. Omitted builds
   * are carried forward from the existing config.
   */
  iosBuild?: number;
  androidBuild?: number;
  /** package.json version, purely to warn about the drift that caused this. */
  packageVersion?: string;
  allowDowngrade?: boolean;
}

export interface AnnouncePlan {
  ok: boolean;
  errors: string[];
  warnings: string[];
  next: Required<AppUpdateConfig>;
}

/** Maximum sensible changelog length for a bottom sheet. */
export const MAX_WHATS_NEW = 500;

/**
 * The exact comparison the client uses (appUpdateService.compareVersions).
 * Duplicated deliberately: if the client's algorithm changes, these guards
 * must be re-derived from it rather than silently disagreeing.
 */
export function compareVersions(a: string, b: string): number {
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

export function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(\.\d+)*$/.test(value.trim());
}

/**
 * Pull the Expo app version out of app.config.js.
 *
 * Read as text rather than imported: app.config.js is ESM that evaluates
 * process.env at load, which a CommonJS admin script can't require cleanly.
 */
export function extractAppVersion(configSource: string): string | null {
  const match = configSource.match(/^\s*version:\s*["']([^"']+)["']/m);
  return match && isValidVersion(match[1]) ? match[1] : null;
}

/**
 * Work out what config/appUpdate should become, refusing anything that would
 * leave the update sheet dead or brick users behind a bad floor.
 */
export function planAnnouncement(input: AnnounceInput): AnnouncePlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const {
    version,
    appConfigVersion,
    currentConfig,
    whatsNew,
    minimumVersion,
    packageVersion,
  } = input;

  const current = currentConfig || {};
  const latest = version;

  if (!isValidVersion(version)) {
    errors.push(`--version "${version}" is not a numeric version string.`);
  }

  // The store can only ever hold a version the source has been built at.
  // Announcing above app.config.js is a typo; announcing below it is the
  // normal state between a bump and the next store release.
  if (isValidVersion(appConfigVersion) && isValidVersion(version)) {
    const cmp = compareVersions(version, appConfigVersion!);
    if (cmp > 0) {
      errors.push(
        `--version "${version}" is newer than app.config.js "${appConfigVersion}". ` +
        `No build of that version can exist, so nobody could update to it.`
      );
    } else if (cmp < 0) {
      warnings.push(
        `app.config.js is already at "${appConfigVersion}", ahead of the "${version}" ` +
        `being announced. Fine between a bump and the next store release — ` +
        `the store version is what clients are told about.`
      );
    }
  }

  // THE guard. If latestVersion sorts below the version clients are running,
  // every client compares as newer than "latest" and the sheet never shows —
  // precisely how this broke at 1.0.74 vs 1.54.
  if (isValidVersion(current.latestVersion) && isValidVersion(version)) {
    if (compareVersions(version, current.latestVersion!) > 0) {
      warnings.push(
        `Replacing a stale latestVersion "${current.latestVersion}" that sorts BELOW the ` +
        `shipping app version "${version}" — the update sheet could never have shown.`
      );
    } else if (compareVersions(version, current.latestVersion!) < 0 && !input.allowDowngrade) {
      errors.push(
        `Refusing to move latestVersion backwards, from "${current.latestVersion}" to ` +
        `"${version}". Pass allowDowngrade only to roll back a bad announcement.`
      );
    }
  }

  // A version-scheme change is what made the old value unreachable. Flag any
  // shape change so it's a decision rather than an accident.
  if (isValidVersion(current.latestVersion) && isValidVersion(version)) {
    const wasParts = current.latestVersion!.split('.').length;
    const nowParts = version.split('.').length;
    if (wasParts !== nowParts) {
      warnings.push(
        `Version scheme changed from ${wasParts}-part ("${current.latestVersion}") to ` +
        `${nowParts}-part ("${version}"). Positional comparison makes these two ` +
        `schemes non-comparable — keep every future release on the new shape.`
      );
    }
  }

  // The drift that seeded the bad value in the first place.
  if (packageVersion && packageVersion !== version) {
    warnings.push(
      `package.json version "${packageVersion}" does not match the "${version}" being ` +
      `announced. The client compares against app.config.js, so package.json is advisory.`
    );
  }

  // Builds are only meaningful against the version they belong to, so a build
  // supplied for a NEW version replaces the old one outright rather than
  // merging with a build number from the previous release.
  const carriedBuilds: StoreBuilds =
    isValidVersion(current.latestVersion) && current.latestVersion === version
      ? { ...(current.latestBuild || {}) }
      : {};
  const nextBuilds: StoreBuilds = { ...carriedBuilds };
  const setBuild = (platform: 'ios' | 'android', value: number | undefined) => {
    if (value === undefined) return;
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`--${platform}-build "${value}" is not a positive whole number.`);
      return;
    }
    const previous = carriedBuilds[platform];
    if (typeof previous === 'number' && value < previous && !input.allowDowngrade) {
      errors.push(
        `Refusing to move the ${platform} build backwards for ${version}, from ${previous} ` +
        `to ${value}. Pass allowDowngrade to roll back a bad announcement.`
      );
      return;
    }
    nextBuilds[platform] = value;
  };
  setBuild('ios', input.iosBuild);
  setBuild('android', input.androidBuild);

  // Announcing a version whose builds are unknown still works — the client
  // then compares versions alone, exactly as it did before builds existed.
  if (Object.keys(nextBuilds).length === 0) {
    warnings.push(
      `No store build numbers for ${version}. Devices on an older BUILD of the same ` +
      `version (Android 1.56 code 171 vs 172) cannot be told apart, so they will not ` +
      `be prompted. Pass --ios-build / --android-build to close that gap.`
    );
  }

  const trimmedWhatsNew = (whatsNew || '').trim();
  if (!trimmedWhatsNew) {
    errors.push('whatsNew is empty — the update sheet would show a blank changelog.');
  } else if (trimmedWhatsNew.length > MAX_WHATS_NEW) {
    errors.push(`whatsNew is ${trimmedWhatsNew.length} chars; keep it under ${MAX_WHATS_NEW}.`);
  }

  // minimumVersion is a force-update floor. Never inferred, only carried
  // forward or set explicitly.
  const nextMinimum = minimumVersion ?? current.minimumVersion ?? '0.0.0';
  if (!isValidVersion(nextMinimum)) {
    errors.push(`minimumVersion "${nextMinimum}" is not a numeric version string.`);
  } else if (isValidVersion(version) && compareVersions(nextMinimum, version) > 0) {
    errors.push(
      `minimumVersion "${nextMinimum}" is above the released version "${version}" — ` +
      `every user would be force-updated to a version that does not exist.`
    );
  }

  if (minimumVersion && isValidVersion(minimumVersion)) {
    warnings.push(
      `minimumVersion is being set to "${minimumVersion}". Everyone below it is BLOCKED ` +
      `from using the app until they update.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    next: {
      latestVersion: latest,
      minimumVersion: nextMinimum,
      latestBuild: nextBuilds,
      minimumBuild: current.minimumBuild ?? {},
      whatsNew: trimmedWhatsNew,
    },
  };
}
