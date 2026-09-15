// @vitest-environment jsdom
/**
 * A tradie told Mate the job was "40 hours", labour only. The draft card said
 * so; the stored quote said 32 h, with four sections summing to 31.5 h, and
 * the price moved with them. The analyse pass had taken the model's own
 * estimate over the hours seeded on the quote.
 *
 * These drive applyProposal through the REAL shared pipeline — only the model
 * call and the price fetch are faked — so what the store saves here is what
 * the phone path saves: the tradie's number, on every path that runs an
 * analyse, and nothing new on the paths where nobody stated any.
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

// The model's answer: four sections whose hours × multiplier sum to 31.5 h,
// under its own 32 h estimate.
const { analyze } = vi.hoisted(() => ({
  analyze: vi.fn(async () => ({
    materials: [
      { name: 'Rough-in labour', searchTerm: '', quantity: 1, unit: 'each', section: 'Rough-in', sectionMultiplier: 3, sectionLaborHours: 2.5 },
      { name: 'Fit-off labour', searchTerm: '', quantity: 1, unit: 'each', section: 'Fit-off', sectionMultiplier: 3, sectionLaborHours: 6 },
      { name: 'Testing', searchTerm: '', quantity: 1, unit: 'each', section: 'Testing', sectionMultiplier: 1, sectionLaborHours: 3 },
      { name: 'Clean-up', searchTerm: '', quantity: 1, unit: 'each', section: 'Clean-up', sectionMultiplier: 2, sectionLaborHours: 1.5 },
    ],
    estimatedHours: 32,
    jobSummary: '',
  })),
}));

// The phone binding, with the model call and the supplier lookups stubbed out
// but the pipeline itself real — the hold under test lives inside it.
vi.mock('../services/materialsPipeline', async () => {
  const pipeline = await vi.importActual<typeof import('../../shared/pricing/pipeline')>('../../shared/pricing/pipeline');
  const deps: import('../../shared/pricing/pipeline').PipelineDeps = {
    analyzeJobDescription: analyze,
    reconcilePricedMaterials: async () => [],
    estimateMaterialPrice: async () => ({ price: null }),
    searchBunningsCandidates: async () => [],
    batchSearchBunnings: async (searches) => searches.map((s) => ({ searchTerm: s.searchTerm, success: true, results: [] })),
    searchReeceCandidates: async () => [],
    isReeceConnected: async () => false,
    loadSupplierGroups: async () => [],
    loadFavorites: async () => ({}),
    loadPersonalRates: async () => [],
    loadTemplates: async () => [],
  };
  return {
    PipelineCancelled: pipeline.PipelineCancelled,
    LAST_RESORT_GUESS_PREFIX: pipeline.LAST_RESORT_GUESS_PREFIX,
    generateMaterialsForQuote: (args: Parameters<typeof pipeline.generateMaterialsForQuote>[1], callbacks?: Parameters<typeof pipeline.generateMaterialsForQuote>[2]) =>
      pipeline.generateMaterialsForQuote(deps, args, callbacks),
    // The real price fetch returns the quote as it came, every labour field
    // untouched; nothing here has a price to find.
    fetchPricesForQuote: vi.fn(async ({ quote }: { quote: import('../types').Quote }) => ({
      updatedQuote: quote,
      fetchedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    })),
  };
});

import { useStore } from './useStore';
import { __resetPricingInFlight } from '../services/assistant/pricingInFlight';
import { updateQuoteCalculations } from '../utils/quoteCalculator';
import type { Quote } from '../types';
import type { DraftQuoteProposal, UpdateQuoteScopeProposal } from '../types/assistant';

const RATE = 90;

const draft: DraftQuoteProposal = {
  id: 'prop-1',
  toolUseId: 'tool-1',
  createdAt: '2026-09-14T01:00:00Z',
  type: 'propose_draft_quote',
  customerDraft: { name: 'Sam Example' },
  jobName: 'Bathroom rough-in and fit-off',
  jobDescription: 'Rough in and fit off two bathrooms in a new extension. Customer supplies the fittings.',
  estimatedDurationHours: 40,
  materialsMode: 'labour_only',
};

function baseQuote(id = 'quote-1'): Quote {
  return {
    id,
    status: 'draft',
    job: { id: 'job-1', name: '', description: '' },
    materials: [],
    sections: [],
    laborRate: RATE,
    laborHours: 0,
    laborTotal: 0,
    materialsSubtotal: 0,
    markup: 0,
    laborMarkup: 0,
    markupAmount: 0,
    subtotal: 0,
    gst: 0,
    total: 0,
    pricesIncludeGst: false,
    gstRegistered: true,
    updatedAt: new Date(),
  } as unknown as Quote;
}

const sectionHours = (q: Quote) => (q.sections ?? []).reduce((sum, s) => sum + s.laborHours * s.multiplier, 0);

let saved: Quote[];

beforeEach(() => {
  vi.clearAllMocks();
  __resetPricingInFlight();
  saved = [];
  useStore.setState({
    contacts: [],
    quotes: [],
    documents: [],
    businessSettings: { defaultLaborRate: RATE, defaultMarkup: 0, pricesIncludeGst: false } as never,
    currentQuote: null,
    getEffectivePlan: () => 'pro',
    saveContact: vi.fn(async () => {}),
    createNewQuote: () => useStore.setState({ currentQuote: baseQuote() } as never),
    updateQuote: (q: Quote) => useStore.setState({ currentQuote: q } as never),
    setCurrentQuote: (q: Quote | null) => useStore.setState({ currentQuote: q } as never),
    saveDraft: vi.fn(async (q: Quote) => {
      saved.push(q);
      useStore.setState((s: { quotes: Quote[] }) => ({ quotes: [...s.quotes.filter((x) => x.id !== q.id), q] }) as never);
    }),
  } as never);
});

describe('propose_draft_quote — the hours the tradie stated are the hours on the quote', () => {
  it('labour only, stated 40 h over a 31.5 h engine split → 40 h, billed at 40 × rate', async () => {
    const result = await useStore.getState().applyProposal(draft);

    expect(result.ok).toBe(true);
    const final = saved[saved.length - 1];
    expect(sectionHours(final)).toBeCloseTo(31.5, 5);
    expect(final.laborHours).toBe(40);
    expect(final.laborExtraHours).toBeCloseTo(8.5, 5);
    expect(final.materials).toHaveLength(0);
    // What the labour screen shows and what the customer is billed.
    expect(updateQuoteCalculations(final).laborTotal).toBeCloseTo(40 * RATE, 5);
    expect(final.job.estimatedHours).toBe(40);
    // The model was given the number as a hard target too.
    expect(analyze.mock.calls[0][0]).toMatchObject({ targetHours: 40 });
  });

  it('a priced draft with stated hours keeps them through the pricing phase', async () => {
    const result = await useStore.getState().applyProposal({ ...draft, materialsMode: undefined });

    expect(result.ok).toBe(true);
    const final = saved[saved.length - 1];
    expect(final.laborHours).toBe(40);
    expect(final.laborExtraHours).toBeCloseTo(8.5, 5);
    expect(final.laborTotal).toBeCloseTo(40 * RATE, 5);
    expect(final.draftStep).toBe('JobPreview');
    // The adjustment is part of the labour the integrity check recomputes, so
    // holding the hours must not make Mate read out a labour figure that
    // "doesn't add up". (The $0 rows it does flag are the stub price fetch.)
    expect((result.review?.integrity ?? []).filter((i) => /labour|hours/i.test(i))).toEqual([]);
  });

  it("no stated hours → the engine's estimate stands, as before", async () => {
    const result = await useStore.getState().applyProposal({ ...draft, estimatedDurationHours: undefined });

    expect(result.ok).toBe(true);
    const final = saved[saved.length - 1];
    expect(final.laborHours).toBe(32);
    expect(final.laborExtraHours).toBeUndefined();
    expect(updateQuoteCalculations(final).laborTotal).toBeCloseTo(31.5 * RATE, 5);
    expect('targetHours' in analyze.mock.calls[0][0]).toBe(false);
  });
});

describe('propose_update_quote_scope — corrected hours are held the same way', () => {
  const scope: UpdateQuoteScopeProposal = {
    id: 'prop-2',
    toolUseId: 'tool-2',
    createdAt: '2026-09-14T01:05:00Z',
    type: 'propose_update_quote_scope',
    quoteId: 'quote-1',
    jobDescription: 'Rough in and fit off two bathrooms, plus the laundry.',
    estimatedDurationHours: 48,
  };

  const existing = (): Quote =>
    ({
      ...baseQuote('quote-1'),
      job: { id: 'job-1', name: 'Bathrooms', description: 'Two bathrooms.' },
      laborHours: 40,
      laborExtraHours: 8.5,
    }) as Quote;

  it('stated 48 h on the correction → 48 h on the re-run quote', async () => {
    useStore.setState({ quotes: [existing()] } as never);

    const result = await useStore.getState().applyProposal(scope);

    expect(result.ok).toBe(true);
    const final = saved[saved.length - 1];
    expect(sectionHours(final)).toBeCloseTo(31.5, 5);
    expect(final.laborHours).toBe(48);
    expect(final.laborExtraHours).toBeCloseTo(16.5, 5);
    expect(final.laborTotal).toBeCloseTo(48 * RATE, 5);
    expect(analyze.mock.calls[0][0]).toMatchObject({ targetHours: 48 });
  });

  it("a correction WITHOUT hours drops the old adjustment and lets the engine re-estimate", async () => {
    useStore.setState({ quotes: [existing()] } as never);

    const result = await useStore.getState().applyProposal({ ...scope, estimatedDurationHours: undefined });

    expect(result.ok).toBe(true);
    const final = saved[saved.length - 1];
    expect(final.laborHours).toBe(32);
    expect(final.laborExtraHours).toBe(0);
    expect(final.laborTotal).toBeCloseTo(31.5 * RATE, 5);
  });
});
