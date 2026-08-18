/**
 * Pure planning logic for the release announcement step.
 *
 * `config/appUpdate` drives the in-app update sheet (src/services/
 * appUpdateService.ts). It went stale at "1.0.74" while the app shipped 1.54,
 * and because the client compares versions positionally, clients read as NEWER
 * than "latest" and the sheet silently never rendered. Nobody noticed, because
 * a dead update prompt looks exactly like a released-and-up-to-date one.
 *
 * Everything here is pure so the guards that prevent a repeat are testable.
 */

export interface AppUpdateConfig {
  latestVersion?: string;
  minimumVersion?: string;
  whatsNew?: string;
}

export interface AnnounceInput {
  /** Version from app.config.js — the value the client actually compares. */
  appVersion: string;
  /** Existing config/appUpdate, or null when the doc is missing. */
  currentConfig: AppUpdateConfig | null;
  whatsNew: string;
  /** Only ever set deliberately: this force-updates everyone below it. */
  minimumVersion?: string;
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
  const { appVersion, currentConfig, whatsNew, minimumVersion, packageVersion } = input;

  const current = currentConfig || {};
  const latest = appVersion;

  if (!isValidVersion(appVersion)) {
    errors.push(`app.config.js version "${appVersion}" is not a numeric version string.`);
  }

  // THE guard. If latestVersion sorts below the version clients are running,
  // every client compares as newer than "latest" and the sheet never shows —
  // precisely how this broke at 1.0.74 vs 1.54.
  if (isValidVersion(current.latestVersion) && isValidVersion(appVersion)) {
    if (compareVersions(appVersion, current.latestVersion!) > 0) {
      warnings.push(
        `Replacing a stale latestVersion "${current.latestVersion}" that sorts BELOW the ` +
        `shipping app version "${appVersion}" — the update sheet could never have shown.`
      );
    } else if (compareVersions(appVersion, current.latestVersion!) < 0 && !input.allowDowngrade) {
      errors.push(
        `Refusing to move latestVersion backwards, from "${current.latestVersion}" to ` +
        `"${appVersion}". Pass allowDowngrade only to roll back a bad announcement.`
      );
    }
  }

  // A version-scheme change is what made the old value unreachable. Flag any
  // shape change so it's a decision rather than an accident.
  if (isValidVersion(current.latestVersion) && isValidVersion(appVersion)) {
    const wasParts = current.latestVersion!.split('.').length;
    const nowParts = appVersion.split('.').length;
    if (wasParts !== nowParts) {
      warnings.push(
        `Version scheme changed from ${wasParts}-part ("${current.latestVersion}") to ` +
        `${nowParts}-part ("${appVersion}"). Positional comparison makes these two ` +
        `schemes non-comparable — keep every future release on the new shape.`
      );
    }
  }

  // The drift that seeded the bad value in the first place.
  if (packageVersion && packageVersion !== appVersion) {
    warnings.push(
      `package.json version "${packageVersion}" does not match app.config.js "${appVersion}". ` +
      `The client reads app.config.js, so that is the one being announced.`
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
  } else if (isValidVersion(appVersion) && compareVersions(nextMinimum, appVersion) > 0) {
    errors.push(
      `minimumVersion "${nextMinimum}" is above the released version "${appVersion}" — ` +
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
      whatsNew: trimmedWhatsNew,
    },
  };
}
