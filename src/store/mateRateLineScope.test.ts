// @vitest-environment jsdom
/**
 * Audit 23 Sep 2026 — a stated price must survive the next step.
 *
 * MSB Civil drafted at their $165/m² all-in rate, then said "I have to do the
 * excavation as well": the scope re-run generated a full materials list and
 * fresh hours on top of the kept rate row, and the quote went from $8,168 to
 * $36,496. Rural Built said "twenty-nine thousand, supply and install" before
 * the draft; Mate promised to set it after pricing and the quote sat at the
 * engine's $45,840.
 *
 * Same harness as mateStatedHours.test.ts: the REAL shared pipeline, with only
 * the model call and the price fetch faked.
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

// The model's answer: a gear row plus labour sections — what a re-run piles
// on top of the tradie's own price when it forgets how the job was charged.
const { analyze } = vi.hoisted(() => ({
  analyze: vi.fn(async () => ({
    materials: [
      { name: 'Crusher dust', searchTerm: 'crusher dust', quantity: 2, unit: 'm³', section: 'Excavation', sectionMultiplier: 1, sectionLaborHours: 6 },
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
import { buildRateWorkItem } from '../services/quotingProfile';
import { updateQuoteCalculations } from '../utils/quoteCalculator';
import { documentService } from '../services/documentService';
import { fetchPricesForQuote } from '../services/materialsPipeline';
import { quoteToDocument } from '../types/documentAdapter';
import type { Material, Quote, RateLine } from '../types';
import type { DraftQuoteProposal, UpdateQuoteScopeProposal } from '../types/assistant';

const RATE = 90;

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

let saved: Quote[];
// The store's own updateQuote recalculates; the stub above doesn't, so read
// totals the way the real one leaves them.
const last = () => updateQuoteCalculations(saved[saved.length - 1]);

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
    // The Set total planner's save when there is no unified Document yet.
    saveQuote: vi.fn(async (q: Quote) => {
      saved.push(q);
      useStore.setState((s: { quotes: Quote[] }) => ({ quotes: [...s.quotes.filter((x) => x.id !== q.id), q] }) as never);
    }),
  } as never);
});

const ALL_IN: RateLine = { label: 'Exposed aggregate concrete', quantity: 45, unit: 'm²', unitPrice: 165, includesMaterials: true };
const LABOUR: RateLine = { label: 'Pour and finish', quantity: 1008, unit: 'm²', unitPrice: 80, includesMaterials: false };

const draft = (over: Partial<DraftQuoteProposal> = {}): DraftQuoteProposal => ({
  id: 'prop-1',
  toolUseId: 'tool-1',
  createdAt: '2026-09-22T12:57:00Z',
  type: 'propose_draft_quote',
  customerDraft: { name: 'Susan' },
  jobName: 'Exposed aggregate concrete',
  jobDescription: 'Pour 45 m² of exposed aggregate concrete in 3 sections, dowelled into the existing slab.',
  ...over,
});

const scope: UpdateQuoteScopeProposal = {
  id: 'prop-2',
  toolUseId: 'tool-2',
  createdAt: '2026-09-22T12:58:30Z',
  type: 'propose_update_quote_scope',
  quoteId: 'quote-1',
  jobDescription: 'Pour 45 m² of exposed aggregate concrete in 3 sections, including our own excavation to 100mm.',
};

const rateRows = (q: Quote) => (q.materials ?? []).filter((m) => m.kind === 'work');
const generatedRows = (q: Quote) => (q.materials ?? []).filter((m) => m.kind !== 'work');

describe('a scope change keeps charging the job the way the tradie charged it', () => {
  it('all-in rate: re-run generates nothing — the rate row is still the whole price', async () => {
    expect((await useStore.getState().applyProposal(draft({ rateLines: [ALL_IN] }))).ok).toBe(true);
    expect(last().total).toBeCloseTo(7425 * 1.1, 2);

    const result = await useStore.getState().applyProposal(scope);

    expect(result.ok).toBe(true);
    expect(analyze).not.toHaveBeenCalled();
    expect(generatedRows(last())).toHaveLength(0);
    expect(rateRows(last())).toHaveLength(1);
    expect(last().job.description).toBe(scope.jobDescription);
    expect(last().total).toBeCloseTo(7425 * 1.1, 2);
  });

  it('labour-only rate: materials are re-worked but no fresh labour lands on top of the rate', async () => {
    expect((await useStore.getState().applyProposal(draft({ rateLines: [LABOUR] }))).ok).toBe(true);
    const labourAfterDraft = last().laborTotal;

    const result = await useStore.getState().applyProposal(scope);

    expect(result.ok).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(rateRows(last())).toHaveLength(1);
    expect(generatedRows(last()).length).toBeGreaterThan(0);
    expect(last().laborTotal).toBe(labourAfterDraft);
    expect(last().laborTotal).toBe(0);
  });

  it('customer supplies everything (labour rate + labour_only): the re-run adds no materials', async () => {
    const applied = await useStore.getState().applyProposal(draft({ rateLines: [LABOUR], materialsMode: 'labour_only' }));
    expect(applied.ok).toBe(true);
    expect(rateRows(last())[0].rateCard).toBe('labour_no_materials');
    expect(rateRows(last())[0].scope).toMatch(/materials supplied by the customer/);

    const result = await useStore.getState().applyProposal(scope);

    expect(result.ok).toBe(true);
    expect(generatedRows(last())).toHaveLength(0);
    expect(last().laborTotal).toBe(0);
    expect(last().total).toBeCloseTo(80640 * 1.1, 2);
  });

  it('a rate row minted before the stamp is read off its scope text', async () => {
    const legacy: Material = { ...buildRateWorkItem(ALL_IN, 'exclusive', false) };
    delete legacy.rateCard;
    useStore.setState({ quotes: [{ ...baseQuote('quote-1'), materials: [legacy] }] } as never);

    const result = await useStore.getState().applyProposal(scope);

    expect(result.ok).toBe(true);
    expect(analyze).not.toHaveBeenCalled();
    expect(last().materials).toHaveLength(1);
  });

  it('no rate rows: the full re-run, as before', async () => {
    useStore.setState({ quotes: [baseQuote('quote-1')] } as never);

    const result = await useStore.getState().applyProposal(scope);

    expect(result.ok).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(generatedRows(last()).length).toBeGreaterThan(0);
  });
});

describe('a total stated before the draft is set when pricing lands', () => {
  it('targetTotal on the draft → the saved quote carries that total, and the tradie is told', async () => {
    const result = await useStore.getState().applyProposal(
      draft({ jobName: 'Custom shed build', jobDescription: 'Build a 12 m x 9 m shed, supply and install.', targetTotal: 29000 }),
    );

    expect(result.ok).toBe(true);
    expect(last().total).toBeCloseTo(29000, 2);
    expect(result.ok && result.note).toMatch(/Total set to your \$29,000/);
  });

  it("sets it on the PRICED rows — a stale copy of the document can't put the materials back to $0", async () => {
    // Pricing lands a real price on every generated row.
    vi.mocked(fetchPricesForQuote).mockImplementationOnce(async ({ quote }: { quote: Quote }) => ({
      updatedQuote: {
        ...quote,
        materials: quote.materials.map((m) => (m.kind === 'work' ? m : { ...m, price: 100, totalPrice: 100 * m.quantity, pricingSource: 'scraper' })),
      },
      fetchedCount: quote.materials.length,
      failedCount: 0,
      skippedCount: 0,
    }) as never);
    // …while the unified document the store would re-read is still the
    // unpriced copy saved before the run (sim, 23 Sep 2026).
    vi.mocked(documentService.getDocumentById).mockImplementation(async () =>
      saved.length ? (quoteToDocument(saved[0]) as never) : null,
    );

    const result = await useStore.getState().applyProposal(
      draft({ jobName: 'Garden shed', jobDescription: 'Supply and install a 6 m x 4 m Colorbond garden shed on the existing slab.', targetTotal: 9000 }),
    );

    expect(result.ok).toBe(true);
    expect(last().total).toBeCloseTo(9000, 2);
    expect(last().materialsSubtotal).toBeGreaterThan(0);
    expect(generatedRows(last()).every((m) => m.price === 100)).toBe(true);
    vi.mocked(documentService.getDocumentById).mockImplementation(async () => null);
  });

  it('no targetTotal → the engine total stands and nothing is said about it', async () => {
    const result = await useStore.getState().applyProposal(draft());

    expect(result.ok).toBe(true);
    expect(result.ok && result.note ? result.note : '').not.toMatch(/Total set/);
  });
});
