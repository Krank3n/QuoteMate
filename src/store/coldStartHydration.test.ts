// @vitest-environment jsdom
/**
 * Cold-start hydration: the device answers first, and a read that never reached
 * the server is never mistaken for an answer.
 *
 * Both rules come from the same measured Android launch (API 36 emulator,
 * 6 Sep 2026, release build 1.56/171). The loaders read Firestore FIRST and
 * only touched AsyncStorage when the cloud came back *empty* — never when it
 * came back *slowly*. Two things fell out of that:
 *
 *   - With the network off, a signed-in tradie with quotes and a business
 *     profile on the device landed in the onboarding wizard and stayed there
 *     for the whole recording. An empty `getDoc` out of the local cache read as
 *     a definitive "never onboarded".
 *   - Even online, the splash sat on five sequential network round trips before
 *     it would show anything at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock factories are hoisted above the module body, so anything they close
// over has to be created inside vi.hoisted.
const { storage, authState, firestoreService } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  // Signed-in by default; individual cases flip it.
  authState: { currentUser: null as { uid: string } | null },
  firestoreService: {
    loadOnboardingStatus: vi.fn(),
    saveOnboardingStatus: vi.fn(async () => {}),
    loadQuotes: vi.fn(),
    saveQuote: vi.fn(async () => {}),
    loadBusinessSettings: vi.fn(),
    saveBusinessSettings: vi.fn(async () => {}),
    loadQuoteCounterFloor: vi.fn(async () => null),
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (storage.has(k) ? storage.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { storage.delete(k); }),
    multiRemove: vi.fn(async (ks: string[]) => { ks.forEach((k) => storage.delete(k)); }),
  },
}));

vi.mock('../config/firebase', () => ({
  auth: authState,
  db: {},
  storage: {},
  functions: {},
  default: {},
}));

vi.mock('../services/firestoreService', () => ({ firestoreService }));

// The store's import graph reaches most expo-* native modules; none of their
// behaviour matters for hydration.
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: vi.fn(async () => {}), deactivateKeepAwake: vi.fn(async () => {}) }));
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), selectionAsync: vi.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
vi.mock('expo-file-system', () => ({ documentDirectory: '/tmp/', cacheDirectory: '/tmp/', writeAsStringAsync: vi.fn(), readAsStringAsync: vi.fn(), getInfoAsync: vi.fn(), EncodingType: { UTF8: 'utf8', Base64: 'base64' } }));
vi.mock('expo-print', () => ({ printToFileAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ shareAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-store-review', () => ({ requestReview: vi.fn(), hasAction: vi.fn(async () => false), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn(), openAuthSessionAsync: vi.fn(), maybeCompleteAuthSession: vi.fn() }));
vi.mock('expo-auth-session', () => ({ makeRedirectUri: vi.fn(() => 'redirect://'), useAuthRequest: vi.fn(), AuthRequest: class {}, ResponseType: {} }));
vi.mock('expo-crypto', () => ({ digestStringAsync: vi.fn(async () => 'hash'), CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, randomUUID: vi.fn(() => 'uuid') }));
vi.mock('expo-contacts', () => ({ requestPermissionsAsync: vi.fn(), getContactsAsync: vi.fn() }));
vi.mock('expo-av', () => ({ Audio: { Sound: class {}, setAudioModeAsync: vi.fn() } }));
vi.mock('expo-image-manipulator', () => ({ manipulateAsync: vi.fn(), SaveFormat: {} }));
vi.mock('expo-mail-composer', () => ({ composeAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));

import { useStore } from './useStore';

const ONBOARDED_KEY = '@quotemate:onboarded';
const QUOTES_KEY = '@quotemate:quotes';

const quote = (id: string) => ({
  id,
  quoteNumber: `Q-${id}`,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  customerName: 'Mia',
  materials: [],
  laborRate: 85,
  laborHours: 2,
  laborTotal: 170,
  markup: 30,
  laborMarkup: 30,
  total: 221,
  status: 'draft',
});

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
  authState.currentUser = { uid: 'u1' };
  useStore.setState({ isOnboarded: null, quotes: [], businessSettings: null } as any);
  firestoreService.loadOnboardingStatus.mockResolvedValue(null);
  firestoreService.loadQuotes.mockResolvedValue(null);
  firestoreService.loadBusinessSettings.mockResolvedValue(null);
});

describe('checkOnboarding', () => {
  it('starts undetermined, not "not onboarded"', () => {
    // The old initial value of `false` is the whole bug: it is indistinguishable
    // from a real answer, so every consumer rendered the wizard on frame one.
    expect(useStore.getState().isOnboarded).toBeNull();
  });

  it('leaves it undetermined when neither the device nor the server can say', async () => {
    // Offline first launch on a device that has never synced.
    await useStore.getState().checkOnboarding();
    expect(useStore.getState().isOnboarded).toBeNull();
  });

  it('REGRESSION: an unreachable server never demotes an onboarded device to the wizard', async () => {
    storage.set(ONBOARDED_KEY, JSON.stringify(true));
    firestoreService.loadOnboardingStatus.mockResolvedValue(null); // offline

    await useStore.getState().checkOnboarding();

    expect(useStore.getState().isOnboarded).toBe(true);
  });

  it('answers from the device without asking the server at all when signed out', async () => {
    authState.currentUser = null;
    storage.set(ONBOARDED_KEY, JSON.stringify(true));

    await useStore.getState().checkOnboarding();

    expect(useStore.getState().isOnboarded).toBe(true);
    expect(firestoreService.loadOnboardingStatus).not.toHaveBeenCalled();
  });

  it('takes the server’s "yes" and writes it to the device for next launch', async () => {
    firestoreService.loadOnboardingStatus.mockResolvedValue(true);

    await useStore.getState().checkOnboarding();

    expect(useStore.getState().isOnboarded).toBe(true);
    expect(storage.get(ONBOARDED_KEY)).toBe(JSON.stringify(true));
  });

  it('takes the server’s "no" for a genuinely new account', async () => {
    firestoreService.loadOnboardingStatus.mockResolvedValue(false);

    await useStore.getState().checkOnboarding();

    expect(useStore.getState().isOnboarded).toBe(false);
  });

  it('heals the cloud instead of re-running the wizard when only the device remembers', async () => {
    // A device that finished onboarding on a build that never wrote the doc, or
    // whose write failed. Making them do it again would overwrite live data.
    storage.set(ONBOARDED_KEY, JSON.stringify(true));
    firestoreService.loadOnboardingStatus.mockResolvedValue(false);

    await useStore.getState().checkOnboarding();

    expect(useStore.getState().isOnboarded).toBe(true);
    expect(firestoreService.saveOnboardingStatus).toHaveBeenCalledWith(true);
  });

  it('paints the device’s answer before the server is asked', async () => {
    storage.set(ONBOARDED_KEY, JSON.stringify(true));
    let onboardedWhenServerCalled: boolean | null = null;
    firestoreService.loadOnboardingStatus.mockImplementation(async () => {
      onboardedWhenServerCalled = useStore.getState().isOnboarded;
      return true;
    });

    await useStore.getState().checkOnboarding();

    // This is what makes the splash lift on a local read rather than a round trip.
    expect(onboardedWhenServerCalled).toBe(true);
  });
});

describe('loadQuotes', () => {
  it('REGRESSION: shows the device’s quotes when the cloud read fails', async () => {
    storage.set(QUOTES_KEY, JSON.stringify([quote('a'), quote('b')]));
    firestoreService.loadQuotes.mockResolvedValue(null); // offline / cache-only

    await useStore.getState().loadQuotes();

    expect(useStore.getState().quotes.map((q: any) => q.id)).toEqual(['a', 'b']);
  });

  it('does NOT re-upload the whole history when the cloud read fails', async () => {
    // `[]` used to mean both "no quotes" and "read failed", so a flaky launch
    // pushed every quote on the device back up one document at a time.
    storage.set(QUOTES_KEY, JSON.stringify([quote('a'), quote('b')]));
    firestoreService.loadQuotes.mockResolvedValue(null);

    await useStore.getState().loadQuotes();

    expect(firestoreService.saveQuote).not.toHaveBeenCalled();
  });

  it('still backfills the cloud when the server confirms the account is empty', async () => {
    storage.set(QUOTES_KEY, JSON.stringify([quote('a')]));
    firestoreService.loadQuotes.mockResolvedValue([]); // confirmed empty, not failed

    await useStore.getState().loadQuotes();

    expect(firestoreService.saveQuote).toHaveBeenCalledTimes(1);
  });

  it('cloud quotes win over the device copy once they arrive', async () => {
    storage.set(QUOTES_KEY, JSON.stringify([quote('stale')]));
    firestoreService.loadQuotes.mockResolvedValue([quote('fresh')]);

    await useStore.getState().loadQuotes();

    expect(useStore.getState().quotes.map((q: any) => q.id)).toEqual(['fresh']);
  });

  it('paints the device copy before the cloud is asked', async () => {
    storage.set(QUOTES_KEY, JSON.stringify([quote('a')]));
    let countWhenCloudCalled = -1;
    firestoreService.loadQuotes.mockImplementation(async () => {
      countWhenCloudCalled = useStore.getState().quotes.length;
      return [quote('fresh')];
    });

    await useStore.getState().loadQuotes();

    expect(countWhenCloudCalled).toBe(1);
  });

  it('never touches the network when signed out', async () => {
    authState.currentUser = null;
    storage.set(QUOTES_KEY, JSON.stringify([quote('a')]));

    await useStore.getState().loadQuotes();

    expect(useStore.getState().quotes).toHaveLength(1);
    expect(firestoreService.loadQuotes).not.toHaveBeenCalled();
  });
});

describe('loadBusinessSettings', () => {
  it('REGRESSION: keeps the device’s profile when the cloud read comes back empty', async () => {
    storage.set(
      '@quotemate:business_settings',
      JSON.stringify({ businessName: 'Riverbend Carpentry' }),
    );
    firestoreService.loadBusinessSettings.mockResolvedValue(null);

    await useStore.getState().loadBusinessSettings();

    expect(useStore.getState().businessSettings?.businessName).toBe('Riverbend Carpentry');
  });

  it('paints the device copy before the cloud is asked', async () => {
    storage.set('@quotemate:business_settings', JSON.stringify({ businessName: 'Local' }));
    let nameWhenCloudCalled: string | undefined;
    firestoreService.loadBusinessSettings.mockImplementation(async () => {
      nameWhenCloudCalled = useStore.getState().businessSettings?.businessName;
      return { businessName: 'Cloud' } as any;
    });

    await useStore.getState().loadBusinessSettings();

    expect(nameWhenCloudCalled).toBe('Local');
    expect(useStore.getState().businessSettings?.businessName).toBe('Cloud');
  });
});
