// @vitest-environment jsdom
/**
 * Photos the tradie sent Mate have to be on the quote BEFORE the analyse pass
 * runs — materialsPipeline reads photos[].storageUrl on its first look at the
 * job, so seeding them afterwards means the gear generator never sees them.
 *
 * They arrive as an Apply-time context argument rather than a proposal field:
 * the model can't know Storage URLs, and proposals are Firestore-synced.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: vi.fn(async () => {}),
  deactivateKeepAwake: vi.fn(async () => {}),
}));
// The store's import graph reaches most expo-* native modules; none of their
// behaviour matters for the photo seeding under test.
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
vi.mock('../services/materialsPipeline', () => ({
  PipelineCancelled: class PipelineCancelled extends Error {},
  generateMaterialsForQuote: vi.fn(async ({ quote }: any) => ({
    updatedQuote: quote,
    generatedMaterialCount: 0,
  })),
  fetchPricesForQuote: vi.fn(async ({ quote }: any) => ({
    updatedQuote: quote,
    fetchedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  })),
}));

import { useStore } from './useStore';
import { generateMaterialsForQuote } from '../services/materialsPipeline';
import type { Quote, QuotePhoto } from '../types';
import type { DraftQuoteProposal } from '../types/assistant';

const PHOTOS: QuotePhoto[] = [
  { id: 'p1', storageUrl: 'https://s/p1.jpg', annotated: false },
  { id: 'p2', storageUrl: 'https://s/p2.jpg', annotated: false, isPlan: true },
];

const proposal: DraftQuoteProposal = {
  id: 'prop-1',
  toolUseId: 'tool-1',
  createdAt: '',
  type: 'propose_draft_quote',
  customerDraft: { name: 'Gigar' },
  jobName: 'Back fence',
  jobDescription: 'Replace 22 m of paling fence along the back boundary.',
};

function baseQuote(): Quote {
  return {
    id: 'quote-1',
    job: { id: 'job-1', name: '', description: '' },
    materials: [],
    laborHours: 0,
  } as unknown as Quote;
}

let updateQuote: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  updateQuote = vi.fn((q: Quote) => useStore.setState({ currentQuote: q } as any));
  useStore.setState({
    contacts: [],
    quotes: [],
    documents: [],
    businessSettings: null,
    currentQuote: null,
    getEffectivePlan: () => 'pro',
    saveContact: vi.fn(async () => {}),
    createNewQuote: () => useStore.setState({ currentQuote: baseQuote() } as any),
    updateQuote,
    saveDraft: vi.fn(async () => {}),
  } as any);
});

describe('propose_draft_quote photo context', () => {
  it('seeds the drafted quote with chat photos from the apply context', async () => {
    const result = await useStore.getState().applyProposal(proposal, undefined, { photos: PHOTOS });

    expect(result.ok).toBe(true);
    const seeded = updateQuote.mock.calls[0][0] as Quote;
    expect(seeded.photos).toEqual(PHOTOS);
    // Seeded BEFORE analyse, so the gear generator sees them on the first pass.
    const analysed = vi.mocked(generateMaterialsForQuote).mock.calls[0][0] as any;
    expect(analysed.quote.photos).toEqual(PHOTOS);
  });

  it('leaves photos off when none passed', async () => {
    await useStore.getState().applyProposal(proposal);
    const seeded = updateQuote.mock.calls[0][0] as Quote;
    expect(seeded.photos).toBeUndefined();
  });

  it('caps the seeded photos at five', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      storageUrl: `https://s/p${i}.jpg`,
      annotated: false,
    }));
    await useStore.getState().applyProposal(proposal, undefined, { photos: many });
    expect((updateQuote.mock.calls[0][0] as Quote).photos).toHaveLength(5);
  });

  it('still refuses the draft on the free plan before any photo is attached', async () => {
    useStore.setState({ getEffectivePlan: () => 'free' } as any);

    const result = await useStore.getState().applyProposal(proposal, undefined, { photos: PHOTOS });

    expect(result).toMatchObject({ ok: false, code: 'PLAN_GATED' });
    expect(updateQuote).not.toHaveBeenCalled();
    expect(generateMaterialsForQuote).not.toHaveBeenCalled();
  });
});
