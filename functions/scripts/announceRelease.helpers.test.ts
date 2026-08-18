import { describe, expect, it } from 'vitest';
import {
  MAX_WHATS_NEW,
  compareVersions,
  extractAppVersion,
  isValidVersion,
  planAnnouncement,
} from './announceRelease.helpers';

const APP_CONFIG_SNIPPET = `
export default {
  expo: {
    name: "QuoteMate",
    slug: "quotemate",
    version: "1.54",
    orientation: "portrait",
    updates: { url: "https://u.expo.dev/abc" },
    runtimeVersion: { policy: "appVersion" },
  },
};
`;

describe('extractAppVersion', () => {
  it('reads the Expo version from app.config.js source', () => {
    expect(extractAppVersion(APP_CONFIG_SNIPPET)).toBe('1.54');
  });

  it('is not fooled by runtimeVersion or other keys', () => {
    expect(extractAppVersion(`
      expo: {
        runtimeVersion: { policy: "appVersion" },
        version: "2.1",
      }
    `)).toBe('2.1');
  });

  it('returns null when there is no version to read', () => {
    expect(extractAppVersion('export default { expo: { name: "x" } }')).toBeNull();
  });
});

describe('version helpers', () => {
  it('matches the client comparison semantics', () => {
    // This is the pairing that silently killed the update sheet.
    expect(compareVersions('1.54', '1.0.74')).toBe(1);
    expect(compareVersions('1.54', '1.55')).toBe(-1);
    expect(compareVersions('1.54', '1.54')).toBe(0);
    expect(compareVersions('1.54', '1.54.0')).toBe(0);
  });

  it('rejects non-numeric versions', () => {
    expect(isValidVersion('1.54')).toBe(true);
    expect(isValidVersion('1.54.0')).toBe(true);
    expect(isValidVersion('v1.54')).toBe(false);
    expect(isValidVersion('1.54-beta')).toBe(false);
    expect(isValidVersion(undefined)).toBe(false);
  });
});

const base = {
  appVersion: '1.55',
  currentConfig: { latestVersion: '1.54', minimumVersion: '1.0.0', whatsNew: 'old' },
  whatsNew: 'Push notifications now tell you when a customer opens your quote.',
};

describe('planAnnouncement', () => {
  it('announces the shipping version', () => {
    const plan = planAnnouncement(base);
    expect(plan.ok).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.next.latestVersion).toBe('1.55');
    expect(plan.next.minimumVersion).toBe('1.0.0');
  });

  it('warns loudly when replacing a stale value the client could never reach', () => {
    // The real situation on 18 Aug 2026: latest "1.0.74", app shipping "1.54".
    const plan = planAnnouncement({
      ...base,
      appVersion: '1.54',
      currentConfig: { latestVersion: '1.0.74', minimumVersion: '1.0.0' },
    });
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/could never have shown/);
    expect(plan.warnings.join(' ')).toMatch(/Version scheme changed from 3-part/);
  });

  it('refuses to move latestVersion backwards', () => {
    const plan = planAnnouncement({ ...base, appVersion: '1.53' });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/backwards/);
  });

  it('allows an explicit rollback', () => {
    const plan = planAnnouncement({ ...base, appVersion: '1.53', allowDowngrade: true });
    expect(plan.ok).toBe(true);
  });

  it('rejects an empty changelog rather than showing a blank sheet', () => {
    expect(planAnnouncement({ ...base, whatsNew: '   ' }).ok).toBe(false);
    expect(planAnnouncement({ ...base, whatsNew: '' }).errors.join(' '))
      .toMatch(/blank changelog/);
  });

  it('rejects an overlong changelog', () => {
    const plan = planAnnouncement({ ...base, whatsNew: 'x'.repeat(MAX_WHATS_NEW + 1) });
    expect(plan.ok).toBe(false);
  });

  it('never invents a force-update floor', () => {
    const plan = planAnnouncement({ ...base, currentConfig: { latestVersion: '1.54' } });
    expect(plan.next.minimumVersion).toBe('0.0.0');
    expect(plan.warnings.join(' ')).not.toMatch(/BLOCKED/);
  });

  it('carries an existing floor forward untouched', () => {
    const plan = planAnnouncement({
      ...base,
      currentConfig: { latestVersion: '1.54', minimumVersion: '1.50' },
    });
    expect(plan.next.minimumVersion).toBe('1.50');
  });

  it('shouts when a force-update floor is set deliberately', () => {
    const plan = planAnnouncement({ ...base, minimumVersion: '1.50' });
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/BLOCKED/);
  });

  it('refuses a floor above the released version', () => {
    // Would lock every user out with nothing to update to.
    const plan = planAnnouncement({ ...base, minimumVersion: '1.60' });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/does not exist/);
  });

  it('flags the package.json drift that seeded the stale value', () => {
    const plan = planAnnouncement({ ...base, packageVersion: '1.0.74' });
    expect(plan.warnings.join(' ')).toMatch(/package\.json version "1\.0\.74"/);
  });

  it('stays quiet when the two version sources agree', () => {
    const plan = planAnnouncement({ ...base, packageVersion: '1.55' });
    expect(plan.warnings.join(' ')).not.toMatch(/package\.json/);
  });

  it('handles a missing config doc', () => {
    const plan = planAnnouncement({ ...base, currentConfig: null });
    expect(plan.ok).toBe(true);
    expect(plan.next.latestVersion).toBe('1.55');
    expect(plan.next.minimumVersion).toBe('0.0.0');
  });
});
