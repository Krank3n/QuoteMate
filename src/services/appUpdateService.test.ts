import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory AsyncStorage.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { store.delete(k); }),
  },
}));

// The installed app version the service compares against.
let installedVersion = '1.55';
vi.mock('expo-constants', () => ({
  default: { get expoConfig() { return { version: installedVersion, extra: {} }; } },
}));

// The running build. appIdentity reaches for expo-application/expo-updates,
// none of which exist in the runner.
let installedBuild: string | null = '171';
vi.mock('./appIdentity', () => ({
  currentAppBuild: () => ({
    version: installedVersion,
    build: installedBuild,
    platform: 'android',
    updateId: null,
    runtimeVersion: null,
    channel: null,
    updatedAt: null,
  }),
}));

// config/appUpdate as the client would read it.
let updateDoc: Record<string, unknown> | null = null;
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({
    exists: () => updateDoc !== null,
    data: () => updateDoc,
  })),
}));

import {
  UPDATE_SNOOZE_MS,
  checkForUpdate,
  compareRelease,
  decideUpdate,
  isSnoozed,
  parseBuild,
  readUpdateSnooze,
  releaseKey,
  snoozeUpdate,
  type AppUpdateInfo,
} from './appUpdateService';

const SNOOZE_KEY = '@quotemate:app_update_snooze';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 2, 9, 0, 0);

const soft: AppUpdateInfo = {
  updateAvailable: true,
  forceUpdate: false,
  latestVersion: '1.56',
  latestBuild: null,
  whatsNew: 'Mate reads plans now.',
};

beforeEach(() => {
  store.clear();
  installedVersion = '1.55';
  installedBuild = '171';
  updateDoc = { latestVersion: '1.56', minimumVersion: '1.0.0', whatsNew: 'Mate reads plans now.' };
});

describe('isSnoozed', () => {
  it('shows when nothing has been dismissed', () => {
    expect(isSnoozed(soft, null, NOW)).toBe(false);
  });

  it('stays quiet for the snooze window after "Maybe later"', () => {
    const snooze = { version: '1.56', dismissedAt: NOW - DAY };
    expect(isSnoozed(soft, snooze, NOW)).toBe(true);
  });

  it('asks once more after the window elapses', () => {
    const snooze = { version: '1.56', dismissedAt: NOW - UPDATE_SNOOZE_MS };
    expect(isSnoozed(soft, snooze, NOW)).toBe(false);
  });

  it('a newer release resets the snooze immediately', () => {
    // Declined 1.56 a minute ago; 1.57 just shipped.
    const snooze = { version: '1.56', dismissedAt: NOW - 60_000 };
    expect(isSnoozed({ ...soft, latestVersion: '1.57' }, snooze, NOW)).toBe(false);
  });

  it('a force update is never snoozed', () => {
    const snooze = { version: '1.56', dismissedAt: NOW - 60_000 };
    expect(isSnoozed({ ...soft, forceUpdate: true }, snooze, NOW)).toBe(false);
  });

  it('does not honour a dismissal stamped in the future', () => {
    // Clock was years ahead when "Maybe later" was tapped, then corrected.
    const snooze = { version: '1.56', dismissedAt: NOW + 365 * DAY };
    expect(isSnoozed(soft, snooze, NOW)).toBe(false);
  });
});

describe('snoozeUpdate / readUpdateSnooze', () => {
  it('round-trips the declined version and time', async () => {
    await snoozeUpdate('1.56', NOW);
    expect(await readUpdateSnooze()).toEqual({ version: '1.56', dismissedAt: NOW });
  });

  it('treats a corrupted stored value as no snooze', async () => {
    store.set(SNOOZE_KEY, 'garbage');
    expect(await readUpdateSnooze()).toBeNull();
    store.set(SNOOZE_KEY, JSON.stringify({ version: 1.56, dismissedAt: 'yesterday' }));
    expect(await readUpdateSnooze()).toBeNull();
  });
});

describe('checkForUpdate', () => {
  it('prompts when the app is behind latest', async () => {
    const info = await checkForUpdate(NOW);
    expect(info).toEqual({
      updateAvailable: true,
      forceUpdate: false,
      latestVersion: '1.56',
      latestBuild: null,
      whatsNew: 'Mate reads plans now.',
    });
  });

  it('is quiet after "Maybe later" until the snooze elapses', async () => {
    await snoozeUpdate('1.56', NOW);
    expect(await checkForUpdate(NOW + DAY)).toBeNull();
    expect(await checkForUpdate(NOW + UPDATE_SNOOZE_MS)).not.toBeNull();
  });

  it('prompts for a newer release even inside an older snooze', async () => {
    await snoozeUpdate('1.56', NOW);
    updateDoc = { ...updateDoc, latestVersion: '1.57' };
    expect((await checkForUpdate(NOW + DAY))?.latestVersion).toBe('1.57');
  });

  it('ignores the snooze when the installed version is below the floor', async () => {
    await snoozeUpdate('1.56', NOW);
    updateDoc = { ...updateDoc, minimumVersion: '1.56' };
    const info = await checkForUpdate(NOW + DAY);
    expect(info?.forceUpdate).toBe(true);
  });

  it('does nothing when already on latest', async () => {
    installedVersion = '1.56';
    expect(await checkForUpdate(NOW)).toBeNull();
  });

  it('does nothing when the config doc is missing', async () => {
    updateDoc = null;
    expect(await checkForUpdate(NOW)).toBeNull();
  });

  it('never prompts off a stale 3-part latestVersion (the dead-sheet bug)', async () => {
    // Positional compare: 1.55 sorts ABOVE 1.0.74, so this doc can never fire.
    // The announce script guards against writing one; this pins the client side.
    updateDoc = { latestVersion: '1.0.74', minimumVersion: '1.0.0', whatsNew: '' };
    expect(await checkForUpdate(NOW)).toBeNull();
  });
});

describe('build-aware updates', () => {
  const config = { latestVersion: '1.56', minimumVersion: '1.0.0', whatsNew: 'x', latestBuild: { ios: 94, android: 172 } };

  it('prompts a device on the same version but an older store build', () => {
    // The case that went unnoticed: Android shipped 1.56 twice, and only
    // versionCode 172 can take an over-the-air update. On version strings
    // alone a 171 device reads itself as current.
    const info = decideUpdate({ currentVersion: '1.56', currentBuild: 171, platform: 'android', config });
    expect(info).toMatchObject({ updateAvailable: true, latestVersion: '1.56', latestBuild: 172 });
  });

  it('stays quiet once the device is on the newest build', () => {
    expect(decideUpdate({ currentVersion: '1.56', currentBuild: 172, platform: 'android', config })).toBeNull();
    expect(decideUpdate({ currentVersion: '1.56', currentBuild: 200, platform: 'android', config })).toBeNull();
  });

  it('reads the build for the running platform, never the other one', () => {
    // iOS build 94 and Android versionCode 172 are unrelated sequences.
    expect(decideUpdate({ currentVersion: '1.56', currentBuild: 94, platform: 'ios', config })).toBeNull();
    expect(decideUpdate({ currentVersion: '1.56', currentBuild: 93, platform: 'ios', config })?.latestBuild).toBe(94);
    // A platform the config says nothing about falls back to versions alone.
    expect(decideUpdate({ currentVersion: '1.56', currentBuild: 1, platform: 'web', config })).toBeNull();
  });

  it('still prompts on an older version whatever the builds say', () => {
    const info = decideUpdate({ currentVersion: '1.55', currentBuild: 999, platform: 'android', config });
    expect(info?.updateAvailable).toBe(true);
  });

  it('behaves exactly as before when the config names no builds', () => {
    const legacy = { latestVersion: '1.56', minimumVersion: '1.0.0', whatsNew: 'x' };
    expect(decideUpdate({ currentVersion: '1.56', currentBuild: 171, platform: 'android', config: legacy })).toBeNull();
    expect(decideUpdate({ currentVersion: '1.55', currentBuild: 171, platform: 'android', config: legacy })?.updateAvailable).toBe(true);
  });

  it('force-updates a build below the floor on the same version', () => {
    const forced = { ...config, minimumVersion: '1.56', minimumBuild: { android: 172 } };
    expect(decideUpdate({ currentVersion: '1.56', currentBuild: 171, platform: 'android', config: forced })?.forceUpdate).toBe(true);
    expect(decideUpdate({ currentVersion: '1.56', currentBuild: 172, platform: 'android', config: forced })).toBeNull();
  });

  it('snoozes each build separately, so declining 171 does not silence 172', () => {
    const at171: AppUpdateInfo = { ...soft, latestVersion: '1.56', latestBuild: 171 };
    const at172: AppUpdateInfo = { ...soft, latestVersion: '1.56', latestBuild: 172 };
    const snooze = { version: releaseKey('1.56', 171), dismissedAt: NOW };
    expect(isSnoozed(at171, snooze, NOW + DAY)).toBe(true);
    expect(isSnoozed(at172, snooze, NOW + DAY)).toBe(false);
  });

  it('parses build numbers and refuses junk', () => {
    expect(parseBuild('172')).toBe(172);
    expect(parseBuild(94)).toBe(94);
    expect(parseBuild('1.56.94')).toBe(1);
    expect(parseBuild('abc')).toBeNull();
    expect(parseBuild(undefined)).toBeNull();
  });

  it('orders releases by version first, then build', () => {
    expect(compareRelease({ version: '1.55', build: 999 }, { version: '1.56', build: 1 })).toBe(-1);
    expect(compareRelease({ version: '1.56', build: 171 }, { version: '1.56', build: 172 })).toBe(-1);
    expect(compareRelease({ version: '1.56', build: 172 }, { version: '1.56', build: 172 })).toBe(0);
    // A missing build on either side means the versions decide.
    expect(compareRelease({ version: '1.56', build: null }, { version: '1.56', build: 172 })).toBe(0);
  });

  it('reads the running build end to end through checkForUpdate', async () => {
    installedVersion = '1.56';
    installedBuild = '171';
    updateDoc = { ...config };
    // The mocked appIdentity reports android, so the android build applies.
    const info = await checkForUpdate(NOW);
    expect(info?.latestBuild).toBe(172);
  });
});
