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
  isSnoozed,
  readUpdateSnooze,
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
  whatsNew: 'Mate reads plans now.',
};

beforeEach(() => {
  store.clear();
  installedVersion = '1.55';
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
