// @vitest-environment jsdom
/**
 * What a Mate draft is minted with.
 *
 * One smoke-alarm job (3 Sep 2026) became three applied drafts, all numbered
 * QU-178840, and its customer landed in the contacts book three times. The
 * number: a Mate draft only ever went through saveDraft, which assigns none,
 * so the mirror fell back to QU- + six digits of the timestamp id — a figure
 * that ticks over every ~2.8 hours. The contact: every draft passed the same
 * customerDraft and every apply saved a fresh one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}));
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
vi.mock('../services/sectionTemplateService', () => ({ loadTemplates: vi.fn(async () => []) }));
vi.mock('../services/materialsPipeline', () => ({
  PipelineCancelled: class PipelineCancelled extends Error {},
  // Read off every priced row when the supplier gap is summarised.
  LAST_RESORT_GUESS_PREFIX: 'Rough guess',
  generateMaterialsForQuote: vi.fn(async ({ quote }: any) => ({ updatedQuote: quote, generatedMaterialCount: 0 })),
  fetchPricesForQuote: vi.fn(async ({ quote }: any) => ({ updatedQuote: quote, fetchedCount: 0, failedCount: 0, skippedCount: 0 })),
}));

import { useStore } from './useStore';
import { fetchPricesForQuote } from '../services/materialsPipeline';
import { __resetPricingInFlight } from '../services/assistant/pricingInFlight';
import type { Contact, Quote } from '../types';
import type { DraftQuoteProposal } from '../types/assistant';

const draft = (extra: Partial<DraftQuoteProposal> = {}): DraftQuoteProposal => ({
  id: `prop-${Math.random()}`,
  toolUseId: 't',
  createdAt: '',
  type: 'propose_draft_quote',
  customerDraft: { name: 'Diane Bunk', address: '1186 Mt Larcom Bracewell Road' },
  jobName: 'Smoke alarms',
  jobDescription: 'Replace two hardwired smoke alarms and fit four battery alarms, Red Dot.',
  ...extra,
});

let minted = 0;
let saved: Quote[];

beforeEach(() => {
  vi.clearAllMocks();
  __resetPricingInFlight();
  saved = [];
  minted = 0;
  useStore.setState({
    contacts: [],
    quotes: [],
    documents: [],
    businessSettings: null,
    currentQuote: null,
    nextQuoteNumber: 17,
    getEffectivePlan: () => 'pro',
    saveContact: vi.fn(async (c: Contact) => {
      useStore.setState((s: any) => ({ contacts: [...s.contacts.filter((x: Contact) => x.id !== c.id), c] }));
    }),
    createNewQuote: () => {
      minted += 1;
      useStore.setState({
        currentQuote: { id: `quote-${minted}`, status: 'draft', job: { id: `job-${minted}`, name: '', description: '' }, materials: [], laborHours: 0, updatedAt: new Date() } as unknown as Quote,
      } as any);
    },
    updateQuote: (q: Quote) => useStore.setState({ currentQuote: q } as any),
    setCurrentQuote: (q: Quote | null) => useStore.setState({ currentQuote: q } as any),
    saveDraft: vi.fn(async (q: Quote) => {
      saved.push(q);
      useStore.setState((s: any) => ({ quotes: [...s.quotes.filter((x: Quote) => x.id !== q.id), q] }));
    }),
  } as any);
});

describe('a Mate draft carries a real quote number', () => {
  it('two drafts minted seconds apart get consecutive numbers from the counter', async () => {
    await useStore.getState().applyProposal(draft());
    await useStore.getState().applyProposal(draft({ jobName: 'Downlights' }));
    const numbers = useStore.getState().quotes.map((q) => q.quoteNumber);
    expect(numbers).toEqual(['Q-017', 'Q-018']);
    // Stamped BEFORE the first save, so the mirror never sees a quote without one.
    expect(saved[0].quoteNumber).toBe('Q-017');
    expect(useStore.getState().nextQuoteNumber).toBe(19);
  });
});

describe('one customer, one contact', () => {
  it('a re-draft that passes the same customerDraft reuses the contact the first apply created', async () => {
    await useStore.getState().applyProposal(draft());
    await useStore.getState().applyProposal(draft({ jobName: 'Fire detectors - Red Dot', customerDraft: { name: 'Diane Bunk' } }));
    await useStore.getState().applyProposal(draft({ jobName: 'Smoke detector install', customerDraft: { name: 'diane  bunk', phone: '0477 535 423' } }));
    const contacts = useStore.getState().contacts;
    expect(contacts).toHaveLength(1);
    // The number that arrived on the third draft fills the gap on the saved contact.
    expect(contacts[0].phone).toBe('0477 535 423');
    expect(contacts[0].address).toBe('1186 Mt Larcom Bracewell Road');
    expect(new Set(useStore.getState().quotes.map((q) => q.contactId)).size).toBe(1);
  });

  it('a same-name contact saved long ago with no number is a different person once the draft carries one', async () => {
    useStore.setState({ contacts: [{ id: 'old', name: 'Diane Bunk', source: 'manual', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }] } as any);
    await useStore.getState().applyProposal(draft({ customerDraft: { name: 'Diane Bunk', phone: '0477 535 423' } }));
    expect(useStore.getState().contacts).toHaveLength(2);
    expect(useStore.getState().contacts.find((c) => c.id === 'old')!.phone).toBeUndefined();
  });

  it('the draft still lands when allocating a number fails', async () => {
    useStore.setState({ getNextQuoteNumber: vi.fn(async () => { throw new Error('storage'); }) } as any);
    const result = await useStore.getState().applyProposal(draft());
    expect(result.ok).toBe(true);
    expect(saved[0].quoteNumber).toBeUndefined();
  });

  it('the same name with a DIFFERENT number is a different person', async () => {
    useStore.setState({ contacts: [{ id: 'c1', name: 'Diane Bunk', phone: '0412 000 000', source: 'manual', createdAt: '', updatedAt: '' }] } as any);
    await useStore.getState().applyProposal(draft({ customerDraft: { name: 'Diane Bunk', phone: '0477 535 423' } }));
    expect(useStore.getState().contacts).toHaveLength(2);
  });

  it('never overwrites a detail the saved contact already has', async () => {
    // Saved moments ago with no number — the re-draft that carries one is the same person.
    const now = new Date().toISOString();
    useStore.setState({ contacts: [{ id: 'c1', name: 'Diane Bunk', email: 'diane@example.com', source: 'manual', createdAt: now, updatedAt: now }] } as any);
    await useStore.getState().applyProposal(draft({ customerDraft: { name: 'Diane Bunk', email: 'wrong@example.com', phone: '0477 535 423' } }));
    const [c] = useStore.getState().contacts;
    expect(useStore.getState().contacts).toHaveLength(1);
    expect(c.email).toBe('diane@example.com');
    expect(c.phone).toBe('0477 535 423');
  });
});

describe('a travel charge stated before the job is drafted', () => {
  /**
   * Travel is a share of the subtotal, so it can only go on once pricing has
   * settled one. The figure the tradie said rides on the draft card and lands
   * at the END of the pipeline — and not at all when the run came back
   * degraded, because a share of totals that aren't real is the wrong money.
   */
  const priceAt = (dollars: number) =>
    vi.mocked(fetchPricesForQuote).mockImplementationOnce(async ({ quote }: any) => ({
      updatedQuote: {
        ...quote,
        materials: [
          { id: 'm1', name: 'Concrete N20', quantity: 4, unit: 'each', price: dollars / 4, totalPrice: dollars },
        ],
      },
      fetchedCount: 1,
      failedCount: 0,
      skippedCount: 0,
    }) as any);

  beforeEach(() => {
    // A quote with every money field set, so the totals are arithmetic and
    // not NaN — the minimal stub the other tests here use never adds up.
    useStore.setState({
      createNewQuote: () => {
        useStore.setState({
          currentQuote: {
            id: 'quote-travel',
            status: 'draft',
            job: { id: 'job-travel', name: '', description: '' },
            materials: [],
            laborHours: 0,
            laborRate: 0,
            markup: 0,
            laborMarkup: 0,
            gstRegistered: false,
            pricesIncludeGst: false,
            updatedAt: new Date(),
          } as unknown as Quote,
        } as any);
      },
    } as any);
  });

  it('lands the stated dollars on the priced draft and moves the total by that much', async () => {
    priceAt(1000);
    const result = await useStore.getState().applyProposal(draft({ travelAdjustment: 80 }));
    expect(result.ok).toBe(true);
    const q = useStore.getState().currentQuote!;
    expect(q.subtotal).toBe(1000);
    // $80 of a $1,000 subtotal is 8% — the same field the labour screen edits.
    expect(q.travelAdjustment).toBe(8);
    expect(q.total).toBe(1080);
    // And it is saved, not just held in memory.
    expect(useStore.getState().quotes.find((x) => x.id === 'quote-travel')!.total).toBe(1080);
  });

  it('leaves travel off a draft where the tradie named no figure', async () => {
    priceAt(1000);
    await useStore.getState().applyProposal(draft());
    const q = useStore.getState().currentQuote!;
    expect(q.travelAdjustment).toBeUndefined();
    expect(q.total).toBe(1000);
  });

  it('puts no travel on a draft the pipeline could not price, and says so', async () => {
    vi.mocked(fetchPricesForQuote).mockImplementationOnce(async () => {
      throw new Error('pricing unavailable');
    });
    const result = await useStore.getState().applyProposal(draft({ travelAdjustment: 80 }));
    expect(useStore.getState().currentQuote!.travelAdjustment).toBeUndefined();
    expect(result.ok && result.pipelineDegraded).toBe(true);
  });
});
