// @vitest-environment jsdom
/**
 * A Mate invoice drafted off a rate line (a progress or final claim) skips
 * the analyse and pricing run, so its auto-convert used to run before the
 * server mirror had copied the quote into the unified `documents`
 * collection. convertDocumentToInvoice then threw "Document not found" and
 * the tradie, told "Here's the invoice", got a quote numbered Q-001.
 * Reproduced three times on the simulator, 15 Sep 2026.
 *
 * The apply path now waits (bounded) for the mirrored document, converts
 * once it lands, and when it never lands says so instead of pretending.
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
  LAST_RESORT_GUESS_PREFIX: 'Rough guess',
  generateMaterialsForQuote: vi.fn(async ({ quote }: any) => ({ updatedQuote: quote, generatedMaterialCount: 0 })),
  fetchPricesForQuote: vi.fn(async ({ quote }: any) => ({ updatedQuote: quote, fetchedCount: 0, failedCount: 0, skippedCount: 0 })),
}));
// Real timers, but the poll interval shrunk to 1 ms so the giving-up case
// (20 reads) runs in milliseconds instead of ten seconds.
vi.mock('./mirroredDocumentWait', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mirroredDocumentWait')>();
  return { ...actual, MATE_INVOICE_MIRROR_WAIT: { attempts: 20, intervalMs: 1 } };
});
// The mirror is a server trigger; here it is whatever this read returns.
vi.mock('../services/documentService', () => ({
  documentService: {
    getDocumentById: vi.fn(async () => null),
    loadDocuments: vi.fn(async () => []),
    saveDocument: vi.fn(async () => {}),
  },
}));

import { useStore } from './useStore';
import { documentService } from '../services/documentService';
import { __resetPricingInFlight } from '../services/assistant/pricingInFlight';
import type { Contact, Quote } from '../types';
import type { Document } from '../types/document';
import type { DraftQuoteProposal } from '../types/assistant';

const claim = (extra: Partial<DraftQuoteProposal> = {}): DraftQuoteProposal => ({
  id: `prop-${Math.random()}`,
  toolUseId: 't',
  createdAt: '',
  type: 'propose_draft_quote',
  customerDraft: { name: 'Priya Nair' },
  jobName: 'Final claim — carport slab',
  jobDescription: 'Final claim for the completed carport slab.',
  documentType: 'invoice',
  rateLines: [{ label: 'Final claim — carport slab', quantity: 1, unit: 'job', unitPrice: 9400, includesMaterials: true }],
  ...extra,
});

const mirroredDoc = (id: string): Document =>
  ({ id, type: 'quote', stage: 'draft', total: 10340, job: { id: 'job-1', name: 'Final claim — carport slab' } }) as unknown as Document;

let minted = 0;
let convertCalls: string[];

beforeEach(() => {
  vi.clearAllMocks();
  __resetPricingInFlight();
  minted = 0;
  convertCalls = [];
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
      useStore.setState((s: any) => ({ quotes: [...s.quotes.filter((x: Quote) => x.id !== q.id), q] }));
    }),
    convertDocumentToInvoice: vi.fn(async (id: string) => {
      convertCalls.push(id);
      return { ...mirroredDoc(id), type: 'invoice' } as Document;
    }),
  } as any);
});

const apply = (proposal: DraftQuoteProposal) => useStore.getState().applyProposal(proposal);

describe('a lump-sum invoice drafted off a rate line waits for the mirror before converting', () => {
  it('converts once the mirrored document lands, even though the rate-card path finished first', async () => {
    vi.mocked(documentService.getDocumentById)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockImplementation(async (id: string) => mirroredDoc(id));

    const result = await apply(claim());

    expect(result.ok).toBe(true);
    expect(convertCalls).toEqual(['quote-1']);
    expect(result.navigate).toEqual({ kind: 'open_invoice', invoiceId: 'quote-1' });
    expect(result.note).toBeUndefined();
    expect(vi.mocked(documentService.getDocumentById).mock.calls.length).toBe(3);
  });

  it('converts straight away when the document is already in memory, without polling', async () => {
    useStore.setState({ documents: [mirroredDoc('quote-1')] } as any);

    const result = await apply(claim());

    expect(convertCalls).toEqual(['quote-1']);
    expect(result.navigate?.kind).toBe('open_invoice');
    expect(documentService.getDocumentById).not.toHaveBeenCalled();
  });

  it('when the mirror never lands it opens the quote and SAYS so, rather than claiming an invoice', async () => {
    vi.mocked(documentService.getDocumentById).mockResolvedValue(null);

    const result = await apply(claim());

    expect(result.ok).toBe(true);
    expect(convertCalls).toEqual([]);
    expect(result.navigate).toEqual({ kind: 'job_preview', quoteId: 'quote-1' });
    expect(result.note).toMatch(/Drafted it as a quote for now/);
    expect(result.note).toMatch(/Create Invoice/);
    // Bounded: it gave up rather than polling forever.
    expect(vi.mocked(documentService.getDocumentById).mock.calls.length).toBe(20);
  });

  it('a plain quote never waits on the mirror at all', async () => {
    const result = await apply(claim({ documentType: 'quote' }));

    expect(result.navigate?.kind).toBe('job_preview');
    expect(convertCalls).toEqual([]);
    expect(documentService.getDocumentById).not.toHaveBeenCalled();
  });
});
