// @vitest-environment jsdom
/**
 * Regression test for the production Background ANR in issue #157.
 *
 * loadQuotes runs inside App.tsx's critical, first-paint-blocking bootstrap
 * batch. On every cold start for a signed-in user it re-serialised the entire
 * quotes history to AsyncStorage (Android SharedPreferences) and AWAITED that
 * write before setting store state. For an established business that blob can
 * be multiple MB, and a slow/stuck native write blocked bootstrap long enough
 * to trip Android's Background ANR watchdog.
 *
 * The mirror write is now fired-and-forgotten after state is set (Firestore is
 * the source of truth), so a slow write can never block first paint. This test
 * simulates a native write that never completes and proves loadQuotes still
 * resolves promptly with the cloud quotes applied to state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    // Simulate a slow/stuck native SharedPreferences write.
    setItem: vi.fn(() => new Promise(() => {})),
    removeItem: vi.fn(async () => {}),
  },
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: vi.fn(async () => {}),
  deactivateKeepAwake: vi.fn(async () => {}),
}));
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
vi.mock('../services/sectionTemplateService', () => ({ loadTemplates: vi.fn(async () => []) }));
vi.mock('../services/documentService', () => ({
  documentService: { getDocumentById: vi.fn(async () => null), saveDocument: vi.fn(async () => {}) },
}));

// Minimal cloud quotes — only the fields loadQuotes's backfill/reconcile path
// and normaliseLabourToHours touch. Canonical labour ('hours') so
// normaliseLabourToHours returns them unchanged.
const CLOUD_QUOTES = [
  { id: 'q-1', quoteNumber: 'Q001', laborMarkup: 30, laborUnit: 'hours' },
  { id: 'q-2', quoteNumber: 'Q002', markup: 25, laborUnit: 'hours' },
];

vi.mock('../services/firestoreService', () => ({
  ASSISTANT_LOGGING_ENABLED: false,
  firestoreService: {
    loadQuotes: vi.fn(async () => CLOUD_QUOTES),
    saveQuote: vi.fn(async () => {}),
  },
}));

import { useStore } from './useStore';

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ quotes: [], nextQuoteNumber: 1 } as any);
});

describe('loadQuotes does not block bootstrap on the offline mirror write (#157)', () => {
  it('resolves and populates state even when AsyncStorage.setItem never completes', async () => {
    await Promise.race([
      useStore.getState().loadQuotes(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('loadQuotes blocked on AsyncStorage.setItem')), 50)
      ),
    ]);

    const quotes = useStore.getState().quotes;
    expect(quotes.map((q) => q.id)).toEqual(['q-1', 'q-2']);
    // laborMarkup backfilled from material markup for the legacy second quote.
    expect(quotes[1].laborMarkup).toBe(25);
  });
});
