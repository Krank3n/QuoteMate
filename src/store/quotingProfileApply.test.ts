// @vitest-environment jsdom
/**
 * The quoting profile on Mate's apply path.
 *
 * Two cards write the profile (a standing rule, a rate); the draft card reads
 * it back as rate lines and a labour-only mode. What matters on apply:
 *   - a rule or rate lands on business settings, deduped and in the right
 *     GST basis, through the ordinary settings save (so it syncs);
 *   - rate lines that cover materials skip the WHOLE pipeline — no analysis,
 *     no pricing — and charge no labour on top;
 *   - a labour-only rate still gets materials worked out, but the analysis's
 *     hours are stripped so labour is not charged twice;
 *   - labour-only mode keeps hours and sections, drops the gear, skips pricing.
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
vi.mock('../services/materialsPipeline', () => ({
  PipelineCancelled: class PipelineCancelled extends Error {},
  generateMaterialsForQuote: vi.fn(async ({ quote }: any) => ({
    updatedQuote: {
      ...quote,
      materials: [
        ...quote.materials,
        { id: 'gen-1', name: 'Roof screws', quantity: 100, unit: 'each', price: 0, totalPrice: 0, manualPriceOverride: false, origin: 'recommended' },
      ],
      sections: [{ id: 's1', name: 'Roof', multiplier: 1, laborHours: 6, laborHoursTotal: 6, laborRate: 85, laborTotal: 510, sortOrder: 0 }],
      laborHours: 6,
    },
    generatedMaterialCount: 1,
  })),
  fetchPricesForQuote: vi.fn(async ({ quote }: any) => ({
    updatedQuote: quote,
    fetchedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  })),
}));

import { useStore } from './useStore';
import { fetchPricesForQuote, generateMaterialsForQuote } from '../services/materialsPipeline';
import type { BusinessSettings, Quote } from '../types';
import type { DraftQuoteProposal } from '../types/assistant';

const base = { id: 'p1', toolUseId: 't1', createdAt: '2026-09-02T00:00:00Z' };

function settings(extra: Partial<BusinessSettings> = {}): BusinessSettings {
  return { businessName: 'Hansen Roofing', defaultLaborRate: 85, defaultMarkup: 30, pricesIncludeGst: false, ...extra };
}

function baseQuote(gst: Partial<Pick<Quote, 'pricesIncludeGst' | 'gstRegistered'>> = {}): Quote {
  return {
    id: 'quote-1',
    job: { id: 'job-1', name: '', description: '' },
    materials: [],
    sections: [],
    laborHours: 0,
    ...gst,
  } as unknown as Quote;
}

const draft = (extra: Partial<DraftQuoteProposal> = {}): DraftQuoteProposal => ({
  ...base,
  type: 'propose_draft_quote',
  customerDraft: { name: 'Adam' },
  jobName: 'Patio roof',
  jobDescription: 'Supply and fit a 40 m² colorbond patio roof attached to the house.',
  ...extra,
});

let setBusinessSettings: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  setBusinessSettings = vi.fn(async (s: BusinessSettings) => useStore.setState({ businessSettings: s } as any));
  useStore.setState({
    contacts: [],
    quotes: [],
    documents: [],
    businessSettings: settings(),
    currentQuote: null,
    getEffectivePlan: () => 'pro',
    saveContact: vi.fn(async () => {}),
    createNewQuote: () => useStore.setState({ currentQuote: baseQuote() } as any),
    updateQuote: vi.fn((q: Quote) => useStore.setState({ currentQuote: q } as any)),
    saveDraft: vi.fn(async () => {}),
    setBusinessSettings,
  } as any);
});

describe('propose_remember_preference', () => {
  it('saves the sentence to business settings, once', async () => {
    const first = await useStore.getState().applyProposal({ ...base, type: 'propose_remember_preference', text: 'Labour separate from materials' });
    expect(first.ok).toBe(true);
    await useStore.getState().applyProposal({ ...base, type: 'propose_remember_preference', text: 'labour SEPARATE from materials' });
    expect(setBusinessSettings).toHaveBeenCalledTimes(2);
    expect(useStore.getState().businessSettings?.quotingPreferences).toEqual(['labour SEPARATE from materials']);
    expect(useStore.getState().businessSettings?.businessName).toBe('Hansen Roofing');
  });

  it('refuses with a plain message when there are no business settings yet', async () => {
    useStore.setState({ businessSettings: null } as any);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_remember_preference', text: 'Labour only' });
    expect(result.ok).toBe(false);
    expect(setBusinessSettings).not.toHaveBeenCalled();
  });
});

describe('propose_save_rate', () => {
  it("saves the rate in the tradie's stated basis, or the business default when unsaid", async () => {
    await useStore.getState().applyProposal({
      ...base,
      type: 'propose_save_rate',
      label: 'Patio roof supply and fit',
      unit: 'm²',
      rate: 220,
      includesMaterials: true,
    });
    await useStore.getState().applyProposal({
      ...base,
      type: 'propose_save_rate',
      label: 'End of lease clean',
      unit: 'room',
      rate: 90,
      pricesIncludeGst: true,
      includesMaterials: true,
      notes: 'minimum 2 rooms',
    });
    const card = useStore.getState().businessSettings?.rateCard ?? [];
    expect(card).toHaveLength(2);
    expect(card[0]).toMatchObject({ label: 'Patio roof supply and fit', unit: 'm²', rate: 220, pricesIncludeGst: false, includesMaterials: true });
    expect(card[1]).toMatchObject({ label: 'End of lease clean', pricesIncludeGst: true, notes: 'minimum 2 rooms' });
  });

  it('replaces a rate saved again under the same label', async () => {
    const save = (rate: number) =>
      useStore.getState().applyProposal({ ...base, type: 'propose_save_rate', label: 'Patio roof', unit: 'm²', rate, includesMaterials: true });
    await save(220);
    await save(240);
    const card = useStore.getState().businessSettings?.rateCard ?? [];
    expect(card).toHaveLength(1);
    expect(card[0].rate).toBe(240);
  });
});

describe('propose_draft_quote with rate lines', () => {
  const patioLine = { label: 'Patio roof supply and fit', quantity: 40, unit: 'm²' as const, unitPrice: 220, pricesIncludeGst: false, includesMaterials: true };

  it('rate lines that cover materials skip analysis and pricing, and charge no labour', async () => {
    const result = await useStore.getState().applyProposal(draft({ rateLines: [patioLine] }));
    expect(result.ok).toBe(true);

    expect(generateMaterialsForQuote).not.toHaveBeenCalled();
    expect(fetchPricesForQuote).not.toHaveBeenCalled();

    const quote = useStore.getState().currentQuote!;
    expect(quote.materials).toHaveLength(1);
    expect(quote.materials[0]).toMatchObject({ kind: 'work', name: 'Patio roof supply and fit', price: 8800, totalPrice: 8800, quantity: 1 });
    expect(quote.materials[0].scope).toBe('40 m² @ $220.00 per m² — materials included');
    expect(quote.laborHours).toBe(0);
  });

  it('converts an ex-GST rate onto an inclusive-GST document', async () => {
    useStore.setState({
      businessSettings: settings({ pricesIncludeGst: true, gstRegistered: true }),
      createNewQuote: () => useStore.setState({ currentQuote: baseQuote({ pricesIncludeGst: true, gstRegistered: true }) } as any),
    } as any);
    await useStore.getState().applyProposal(draft({ rateLines: [patioLine] }));
    expect(useStore.getState().currentQuote!.materials[0].price).toBe(9680);
  });

  it('a labour-only rate still gets materials worked out and priced, with the analysis labour stripped', async () => {
    await useStore.getState().applyProposal(draft({ rateLines: [{ ...patioLine, includesMaterials: false, unitPrice: 45 }] }));

    expect(generateMaterialsForQuote).toHaveBeenCalledTimes(1);
    expect(fetchPricesForQuote).toHaveBeenCalledTimes(1);

    const quote = useStore.getState().currentQuote!;
    expect(quote.materials.map((m) => m.name)).toEqual(['Patio roof supply and fit', 'Roof screws']);
    expect(quote.materials[0].price).toBe(1800);
    expect(quote.laborHours).toBe(0);
    expect(quote.sections?.[0]).toMatchObject({ laborHours: 0, laborHoursTotal: 0, laborTotal: 0, laborRate: 85 });
  });

  it('labour-only mode keeps hours and sections, drops the gear list and skips pricing', async () => {
    await useStore.getState().applyProposal(draft({ materialsMode: 'labour_only', estimatedDurationHours: 4 }));

    expect(generateMaterialsForQuote).toHaveBeenCalledTimes(1);
    expect(fetchPricesForQuote).not.toHaveBeenCalled();

    const quote = useStore.getState().currentQuote!;
    expect(quote.materials).toEqual([]);
    expect(quote.laborHours).toBe(6);
    expect(quote.sections).toHaveLength(1);
  });

  it('a plain draft still runs both phases exactly as before', async () => {
    await useStore.getState().applyProposal(draft({ estimatedDurationHours: 3 }));
    expect(generateMaterialsForQuote).toHaveBeenCalledTimes(1);
    expect(fetchPricesForQuote).toHaveBeenCalledTimes(1);
    const quote = useStore.getState().currentQuote!;
    expect(quote.materials.map((m) => m.name)).toEqual(['Roof screws']);
    expect(quote.laborHours).toBe(6);
  });
});
