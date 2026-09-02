// @vitest-environment jsdom
/**
 * The 2 Sep 2026 draft audit. Drafts had climbed to 69% of the week's quotes
 * and the new bucket was Mate-minted quotes that never touched the wizard:
 *
 *   - Mate never stamped `draftStep`, and both the dashboard's draft banner
 *     (pickDashboardDraft) and the unsent-quote nudge (followUpNudge) key on
 *     it — so nothing in the app ever pointed back at a Mate draft.
 *   - A scope correction after Apply could only be a second propose_draft_quote,
 *     which minted a second quote for the same job (Overton x2, Lee-Anne x2).
 *   - The model learned the quote id only after the 15–40 s pipeline, so a
 *     correction typed during pricing was re-drafted rather than folded in.
 *
 * These pin the store side of all three.
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
// resolveDocument's Firestore fallback — an unknown id must fail plainly, not hit the network.
vi.mock('../services/documentService', () => ({
  documentService: { getDocumentById: vi.fn(async () => null), saveDocument: vi.fn(async () => {}) },
}));
vi.mock('../services/materialsPipeline', () => ({
  PipelineCancelled: class PipelineCancelled extends Error {},
  // Same shape as the real analyse pass: with rows already on the quote it
  // APPENDS the new list and ADDS its hours (materialsPipeline `hasExistingMaterials`).
  generateMaterialsForQuote: vi.fn(async ({ quote }: any) => {
    const fresh = [{ id: `gen-${quote.materials.length}`, name: 'Gear', price: 0, quantity: 1, manualPriceOverride: false }];
    const hasExisting = quote.materials.length > 0;
    return {
      updatedQuote: {
        ...quote,
        materials: hasExisting ? [...quote.materials, ...fresh] : fresh,
        laborHours: hasExisting ? quote.laborHours + 5 : 5,
      },
      generatedMaterialCount: 1,
    };
  }),
  fetchPricesForQuote: vi.fn(async ({ quote }: any) => ({
    updatedQuote: quote,
    fetchedCount: 1,
    failedCount: 0,
    skippedCount: 0,
  })),
}));

import { useStore } from './useStore';
import { generateMaterialsForQuote } from '../services/materialsPipeline';
import { markPricingStarted, __resetPricingInFlight } from '../services/assistant/pricingInFlight';
import type { Quote } from '../types';
import type { DraftQuoteProposal, UpdateQuoteScopeProposal } from '../types/assistant';

const draft: DraftQuoteProposal = {
  id: 'prop-1',
  toolUseId: 'tool-1',
  createdAt: '',
  type: 'propose_draft_quote',
  customerDraft: { name: 'Lee-Anne' },
  jobName: 'Patio roof',
  jobDescription: 'Re-sheet the 4.4 x 2.6 m patio roof in Trimdek, Classic Cream.',
};

function baseQuote(id = 'quote-1'): Quote {
  return {
    id,
    status: 'draft',
    job: { id: 'job-1', name: '', description: '' },
    materials: [],
    laborHours: 0,
    updatedAt: new Date(),
  } as unknown as Quote;
}

let saved: Quote[];

beforeEach(() => {
  vi.clearAllMocks();
  __resetPricingInFlight();
  saved = [];
  useStore.setState({
    contacts: [],
    quotes: [],
    documents: [],
    businessSettings: null,
    currentQuote: null,
    getEffectivePlan: () => 'pro',
    saveContact: vi.fn(async () => {}),
    createNewQuote: () => useStore.setState({ currentQuote: baseQuote() } as any),
    updateQuote: (q: Quote) => useStore.setState({ currentQuote: q } as any),
    setCurrentQuote: (q: Quote | null) => useStore.setState({ currentQuote: q } as any),
    saveDraft: vi.fn(async (q: Quote) => {
      saved.push(q);
      useStore.setState((s: any) => ({
        quotes: [...s.quotes.filter((x: Quote) => x.id !== q.id), q],
      }));
    }),
  } as any);
});

describe('propose_draft_quote — the minted quote is a finished-but-unsent draft', () => {
  it('stamps draftStep JobPreview once pricing lands, so the banner and nudge can find it', async () => {
    const result = await useStore.getState().applyProposal(draft);
    expect(result.ok).toBe(true);
    const final = saved[saved.length - 1];
    expect(final.draftStep).toBe('JobPreview');
    expect(useStore.getState().quotes.find((q) => q.id === 'quote-1')?.draftStep).toBe('JobPreview');
  });

  it('parks a pricing snag on MaterialsList — where Fetch Prices lives — instead of leaving it unstamped', async () => {
    vi.mocked(generateMaterialsForQuote).mockRejectedValueOnce(new Error('scraper down'));
    const result = await useStore.getState().applyProposal(draft);
    expect(result).toMatchObject({ ok: true, pipelineDegraded: true });
    expect(saved[saved.length - 1].draftStep).toBe('MaterialsList');
  });

  it('hands the quote id to the screen BEFORE the pipeline runs', async () => {
    const order: string[] = [];
    vi.mocked(generateMaterialsForQuote).mockImplementationOnce(async ({ quote }: any) => {
      order.push('analyse');
      return { updatedQuote: quote, generatedMaterialCount: 0 };
    });
    const onMinted = vi.fn((id: string) => order.push(`minted:${id}`));
    await useStore.getState().applyProposal(draft, undefined, { onMinted });
    expect(onMinted).toHaveBeenCalledWith('quote-1');
    expect(order).toEqual(['minted:quote-1', 'analyse']);
  });
});

describe('propose_update_quote_scope — a correction edits the quote, it does not mint another', () => {
  const scope: UpdateQuoteScopeProposal = {
    id: 'prop-2',
    toolUseId: 'tool-2',
    createdAt: '',
    type: 'propose_update_quote_scope',
    quoteId: 'quote-1',
    jobDescription: 'Full board upgrade — Hager 100A 3-pole main switch, 15 Hager RCBOs, keep the chassis.',
    estimatedDurationHours: 6,
  };

  it('re-runs analyse + pricing over the SAME quote with the merged scope and stamps JobPreview', async () => {
    const existing = {
      ...baseQuote('quote-1'),
      job: { id: 'job-1', name: 'Switchboard upgrade — Overton', description: 'Old scope.' },
      laborHours: 8,
    } as Quote;
    useStore.setState({ quotes: [existing] } as any);

    const result = await useStore.getState().applyProposal(scope);

    expect(result).toMatchObject({ ok: true, navigate: { kind: 'job_preview', quoteId: 'quote-1' } });
    const analysed = vi.mocked(generateMaterialsForQuote).mock.calls[0][0] as any;
    expect(analysed.quote.id).toBe('quote-1');
    expect(analysed.quote.job.description).toContain('Hager');
    expect(analysed.quote.job.name).toBe('Switchboard upgrade — Overton'); // untouched when not given
    expect(analysed.quote.laborHours).toBe(6);
    expect(useStore.getState().quotes).toHaveLength(1);
    expect(saved[saved.length - 1].draftStep).toBe('JobPreview');
  });

  // The sim run on 2 Sep 2026: "12 m" re-run over the "10 m" draft left 22
  // rows (10 old + 12 new) and doubled the labour, because the analyse pass
  // appends over whatever is already there.
  it('clears the previous run\'s generated rows and hours first, so the list is not doubled', async () => {
    const priced = {
      ...baseQuote('quote-1'),
      job: { id: 'job-1', name: 'Fence', description: '10 m of fence.' },
      materials: [
        { id: 'old-1', name: 'Post', price: 20, quantity: 10, manualPriceOverride: false, section: 'Fence' },
        { id: 'old-2', name: 'Paling', price: 3, quantity: 90, manualPriceOverride: false, section: 'Fence' },
        { id: 'mine', name: 'Skip bin', price: 250, quantity: 1, manualPriceOverride: true, section: 'Site' },
      ],
      sections: [
        { id: 's1', name: 'Fence', multiplier: 1, laborHours: 10, laborRate: 120, laborUnit: 'hours', laborTotal: 1200, sortOrder: 0 },
        { id: 's2', name: 'Site', multiplier: 1, laborHours: 1, laborRate: 120, laborUnit: 'hours', laborTotal: 120, sortOrder: 1 },
      ],
      laborHours: 11,
    } as unknown as Quote;
    useStore.setState({ quotes: [priced] } as any);

    await useStore.getState().applyProposal({ ...scope, estimatedDurationHours: undefined, jobDescription: '12 m of fence, same spec.' });

    const analysed = vi.mocked(generateMaterialsForQuote).mock.calls[0][0] as any;
    // Only the tradie's own row goes back in as "existing"; the generated rows are gone.
    expect(analysed.quote.materials.map((m: any) => m.id)).toEqual(['mine']);
    expect(analysed.quote.sections.map((s: any) => s.name)).toEqual(['Site']);
    expect(analysed.quote.laborHours).toBe(0);
    const final = saved[saved.length - 1];
    expect(final.materials.map((m: any) => m.id)).toEqual(['mine', 'gen-1']);
    expect(final.laborHours).toBe(5);
    expect(useStore.getState().quotes).toHaveLength(1);
  });

  it('refuses while that quote is still being priced, rather than racing the first run', async () => {
    useStore.setState({ quotes: [baseQuote('quote-1')] } as any);
    markPricingStarted('quote-1');
    const result = await useStore.getState().applyProposal(scope);
    expect(result.ok).toBe(false);
    expect(generateMaterialsForQuote).not.toHaveBeenCalled();
  });

  it('refuses to rewrite a quote the customer has already seen', async () => {
    useStore.setState({ quotes: [{ ...baseQuote('quote-1'), status: 'sent' } as Quote] } as any);
    const result = await useStore.getState().applyProposal(scope);
    expect(result.ok).toBe(false);
    expect(generateMaterialsForQuote).not.toHaveBeenCalled();
  });

  it('fails plainly on an unknown id', async () => {
    const result = await useStore.getState().applyProposal({ ...scope, quoteId: 'nope' });
    expect(result).toMatchObject({ ok: false, error: 'Quote not found.' });
    expect(generateMaterialsForQuote).not.toHaveBeenCalled();
  });
});
