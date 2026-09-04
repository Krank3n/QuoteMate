// @vitest-environment jsdom
/**
 * "Also — 1 figure on this quote don't add up (stored materialsSubtotal=0,
 * recomputed=245.4)." — read out to a tradie on a $500 smoke-alarm job,
 * 4 Sep 2026, on a quote whose figures were fine.
 *
 * finishPriced ran checkDocumentIntegrity against the object
 * fetchPricesForQuote returns, which is `{ ...quote, materials }`: the rows
 * carry their new prices and every money field is still whatever it was
 * BEFORE the run — $0 on a freshly minted draft. So the check compared $0
 * against the rows it had just priced and fired on EVERY phone-priced draft.
 * (The server path escaped it: pricingRun's quotePatch recalculates before
 * writing, and the phone reads that back.)
 *
 * The totals are settled first now. These pin both halves: no phantom issue
 * on a clean quote, and a genuinely inconsistent one still reported.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
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

// The smoke-alarm job's four rows, at the prices the run came back with.
const PRICED_ROWS = [
  { id: 'm1', name: 'Photoelectric smoke alarm', quantity: 2, unit: 'each', price: 39, totalPrice: 78, manualPriceOverride: false, origin: 'recommended' },
  { id: 'm2', name: 'Mounting screws 8g x 30mm', quantity: 1, unit: 'pack', price: 11.9, totalPrice: 11.9, manualPriceOverride: false, origin: 'recommended' },
  { id: 'm3', name: 'Plasterboard wall plugs / anchors', quantity: 4, unit: 'each', price: 35, totalPrice: 140, manualPriceOverride: false, origin: 'recommended' },
  { id: 'm4', name: 'Gap filler / patching compound', quantity: 2, unit: 'each', price: 7.75, totalPrice: 15.5, manualPriceOverride: false, origin: 'recommended' },
];
const ROWS_TOTAL = 245.4;

vi.mock('../services/materialsPipeline', () => ({
  PipelineCancelled: class PipelineCancelled extends Error {},
  LAST_RESORT_GUESS_PREFIX: 'Rough guess',
  generateMaterialsForQuote: vi.fn(async ({ quote }: any) => ({
    updatedQuote: {
      ...quote,
      materials: PRICED_ROWS.map((m) => ({ ...m, price: 0, totalPrice: 0 })),
      sections: [{ id: 's1', name: 'Smoke Alarm Point', multiplier: 2, laborHours: 0.5, laborHoursTotal: 1, laborRate: 120, laborUnit: 'hours', laborTotal: 120, sortOrder: 0 }],
      laborHours: 1,
    },
    generatedMaterialCount: PRICED_ROWS.length,
  })),
  // The real one prices the rows and returns the quote otherwise untouched —
  // money fields included. That is the whole bug.
  fetchPricesForQuote: vi.fn(async ({ quote }: any) => ({
    updatedQuote: { ...quote, materials: PRICED_ROWS.map((m) => ({ ...m })) },
    fetchedCount: PRICED_ROWS.length,
    failedCount: 0,
    skippedCount: 0,
  })),
}));

import { useStore } from './useStore';
import { fetchPricesForQuote } from '../services/materialsPipeline';
import type { BusinessSettings, Quote } from '../types';
import type { DraftQuoteProposal } from '../types/assistant';

const draft: DraftQuoteProposal = {
  id: 'prop-1',
  toolUseId: 'tool-1',
  createdAt: '2026-09-04T02:17:00Z',
  type: 'propose_draft_quote',
  customerDraft: { name: 'Slim Jim' },
  jobName: 'Smoke alarm install',
  jobDescription: 'Install two photoelectric smoke alarms, no existing units to remove.',
};

// A freshly minted draft: the money fields are real numbers, all zero. They
// have to be numbers — checkDocumentIntegrity skips `undefined`, so a quote
// without them would pass no matter what the code did.
function baseQuote(): Quote {
  return {
    id: 'quote-1',
    status: 'draft',
    job: { id: 'job-1', name: '', description: '' },
    materials: [],
    sections: [],
    laborRate: 120,
    laborHours: 0,
    laborTotal: 0,
    materialsSubtotal: 0,
    markup: 30,
    laborMarkup: 30,
    markupAmount: 0,
    subtotal: 0,
    gst: 0,
    total: 0,
    pricesIncludeGst: false,
    gstRegistered: true,
    updatedAt: new Date(),
  } as unknown as Quote;
}

let saved: Quote[];

beforeEach(() => {
  vi.clearAllMocks();
  saved = [];
  useStore.setState({
    contacts: [],
    quotes: [],
    documents: [],
    businessSettings: { businessName: 'HansenDev', defaultLaborRate: 120, defaultMarkup: 30, pricesIncludeGst: false } as BusinessSettings,
    currentQuote: null,
    getEffectivePlan: () => 'pro',
    saveContact: vi.fn(async () => {}),
    createNewQuote: () => useStore.setState({ currentQuote: baseQuote() } as any),
    // The real store recalculates in here. Deliberately left as a plain set so
    // the test proves finishPriced settles the totals itself rather than
    // leaning on updateQuote's side effect.
    updateQuote: (q: Quote) => useStore.setState({ currentQuote: q } as any),
    setCurrentQuote: (q: Quote | null) => useStore.setState({ currentQuote: q } as any),
    saveDraft: vi.fn(async (q: Quote) => {
      saved.push(q);
      useStore.setState((s: any) => ({ quotes: [...s.quotes.filter((x: Quote) => x.id !== q.id), q] }));
    }),
  } as any);
});

describe('a phone-priced draft is reviewed against its own settled totals', () => {
  it('raises no "figures don\'t add up" on a quote whose rows were just priced', async () => {
    const result = await useStore.getState().applyProposal(draft);

    expect(result.ok).toBe(true);
    expect(result.review?.integrity).toBeUndefined();
    expect(result.review?.summary ?? '').not.toContain("don't add up");
  });

  it('settles materialsSubtotal off the priced rows before saving the draft', async () => {
    await useStore.getState().applyProposal(draft);

    const final = saved[saved.length - 1];
    expect(final.materialsSubtotal).toBe(ROWS_TOTAL);
    expect(final.subtotal).toBe(ROWS_TOTAL + 120);
    expect(final.draftStep).toBe('JobPreview');
  });

  it('still reports a real inconsistency — a section whose labour does not match its own hours', async () => {
    vi.mocked(fetchPricesForQuote).mockImplementationOnce(async ({ quote }: any) => ({
      updatedQuote: {
        ...quote,
        materials: PRICED_ROWS.map((m) => ({ ...m })),
        // 0.5 h × $120 × 2 is $120, not $700. Recalculating totals cannot
        // paper this over, so the tradie should still hear about it.
        sections: [{ ...quote.sections[0], laborTotal: 700 }],
      },
      fetchedCount: PRICED_ROWS.length,
      failedCount: 0,
      skippedCount: 0,
    }));

    const result = await useStore.getState().applyProposal(draft);

    expect(result.review?.integrity ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining('section "Smoke Alarm Point" laborTotal=700')]),
    );
    expect(result.review?.summary ?? '').toContain("don't add up");
  });
});
