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
  version: '1.55',
  currentConfig: { latestVersion: '1.54', minimumVersion: '1.0.0', whatsNew: 'old' },
  whatsNew: 'Push notifications now tell you when a customer opens your quote.',
};

describe('planAnnouncement', () => {
  it('announces the store version', () => {
    const plan = planAnnouncement(base);
    expect(plan.ok).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.next.latestVersion).toBe('1.55');
    expect(plan.next.minimumVersion).toBe('1.0.0');
  });

  it('rejects a non-numeric --version', () => {
    const plan = planAnnouncement({ ...base, version: 'v1.55' });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/--version "v1\.55"/);
  });

  it('warns loudly when replacing a stale value the client could never reach', () => {
    // The real situation on 18 Aug 2026: latest "1.0.74", app shipping "1.54".
    const plan = planAnnouncement({
      ...base,
      version: '1.54',
      currentConfig: { latestVersion: '1.0.74', minimumVersion: '1.0.0' },
    });
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/could never have shown/);
    expect(plan.warnings.join(' ')).toMatch(/Version scheme changed from 3-part/);
  });

  it('refuses to move latestVersion backwards', () => {
    const plan = planAnnouncement({ ...base, version: '1.53' });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/backwards/);
  });

  it('allows an explicit rollback', () => {
    const plan = planAnnouncement({ ...base, version: '1.53', allowDowngrade: true });
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

  it('stays quiet when package.json agrees', () => {
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

describe('planAnnouncement vs app.config.js', () => {
  it('stays quiet when app.config.js matches the store', () => {
    const plan = planAnnouncement({ ...base, appConfigVersion: '1.55' });
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(' ')).not.toMatch(/app\.config\.js/);
  });

  it('accepts the store version when app.config.js has already moved on', () => {
    // 2 Sep 2026: app.config.js bumped to 1.56 as an OTA fence while 1.55 is
    // what the stores serve. Announcing 1.56 would have sent everyone to a
    // version they could not download.
    const plan = planAnnouncement({ ...base, appConfigVersion: '1.56' });
    expect(plan.ok).toBe(true);
    expect(plan.next.latestVersion).toBe('1.55');
    expect(plan.warnings.join(' ')).toMatch(/already at "1\.56", ahead of the "1\.55"/);
  });

  it('refuses a version the source has never been built at', () => {
    const plan = planAnnouncement({ ...base, version: '1.57', appConfigVersion: '1.56' });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/No build of that version can exist/);
  });

  it('skips the check when app.config.js could not be read', () => {
    const plan = planAnnouncement({ ...base, appConfigVersion: undefined });
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(' ')).not.toMatch(/app\.config\.js/);
  });

  it('plans the real 1.55 announcement with every warning it deserves', () => {
    const plan = planAnnouncement({
      version: '1.55',
      appConfigVersion: '1.56',
      packageVersion: '1.55',
      currentConfig: { latestVersion: '1.0.74', minimumVersion: '1.0.0', whatsNew: '' },
      whatsNew: 'Mate greets you first now.',
    });
    expect(plan.ok).toBe(true);
    expect(plan.next).toEqual({
      latestVersion: '1.55',
      minimumVersion: '1.0.0',
      // No build flags passed, and the version changed, so the previous
      // release's build numbers are cleared rather than carried onto it.
      latestBuild: {},
      minimumBuild: {},
      whatsNew: 'Mate greets you first now.',
    });
    const text = plan.warnings.join(' ');
    expect(text).toMatch(/could never have shown/);
    expect(text).toMatch(/3-part/);
    expect(text).toMatch(/ahead of the "1\.55"/);
    expect(text).not.toMatch(/package\.json/);
    expect(text).not.toMatch(/BLOCKED/);
  });
});

describe('store build numbers', () => {
  const base = {
    version: '1.56',
    appConfigVersion: '1.56',
    whatsNew: 'Mate prices in the background now.',
  };

  it('records the build per platform, so two releases of one version differ', () => {
    // The gap this closes: Android 1.56 shipped as versionCode 171 and 172,
    // and a 171 device comparing version strings alone read itself as current.
    const plan = planAnnouncement({
      ...base,
      currentConfig: { latestVersion: '1.55', minimumVersion: '1.0.0', whatsNew: '' },
      iosBuild: 94,
      androidBuild: 172,
    });
    expect(plan.ok).toBe(true);
    expect(plan.next.latestBuild).toEqual({ ios: 94, android: 172 });
  });

  it('carries a build forward when re-announcing the same version', () => {
    const plan = planAnnouncement({
      ...base,
      currentConfig: { latestVersion: '1.56', minimumVersion: '1.0.0', whatsNew: '', latestBuild: { ios: 94, android: 171 } },
      androidBuild: 172,
    });
    expect(plan.next.latestBuild).toEqual({ ios: 94, android: 172 });
  });

  it('drops the old builds when the version moves on', () => {
    const plan = planAnnouncement({
      ...base,
      version: '1.57',
      appConfigVersion: '1.57',
      currentConfig: { latestVersion: '1.56', minimumVersion: '1.0.0', whatsNew: '', latestBuild: { android: 172 } },
    });
    // 172 belongs to 1.56; carrying it onto 1.57 would claim a build nobody has.
    expect(plan.next.latestBuild).toEqual({});
  });

  it('refuses a build that moves backwards, or is not a whole number', () => {
    const back = planAnnouncement({
      ...base,
      currentConfig: { latestVersion: '1.56', minimumVersion: '1.0.0', whatsNew: '', latestBuild: { android: 172 } },
      androidBuild: 171,
    });
    expect(back.ok).toBe(false);
    expect(back.errors.join(' ')).toMatch(/backwards/);

    const junk = planAnnouncement({
      ...base,
      currentConfig: null,
      iosBuild: Number.NaN,
    });
    expect(junk.ok).toBe(false);
    expect(junk.errors.join(' ')).toMatch(/positive whole number/);
  });

  it('allows a deliberate rollback', () => {
    const plan = planAnnouncement({
      ...base,
      currentConfig: { latestVersion: '1.56', minimumVersion: '1.0.0', whatsNew: '', latestBuild: { android: 172 } },
      androidBuild: 171,
      allowDowngrade: true,
    });
    expect(plan.ok).toBe(true);
    expect(plan.next.latestBuild).toEqual({ android: 171 });
  });

  it('warns when a release is announced with no build numbers at all', () => {
    const plan = planAnnouncement({ ...base, currentConfig: null });
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/cannot be told apart/);
  });
});
