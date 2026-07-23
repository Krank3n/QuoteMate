// @vitest-environment jsdom
/**
 * Regression tests for convertDocumentToInvoice's legacy source-quote stamp.
 *
 * Jul 2026: the unified convert path flipped the Document to type 'invoice'
 * but never stamped the legacy quotes row, leaving it status 'draft' with a
 * wizard draftStep. The dashboard then offered "Continue draft" for a job
 * that was already invoiced (and paid). The stamp must also run BEFORE the
 * unified doc flips type, because saveQuote's forward-only type guard
 * re-routes to saveInvoice once the doc is an invoice — which would swallow
 * the stamp entirely.
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
// behaviour matters for the conversion-stamp logic under test.
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
import type { Document } from '../types/document';
import type { Quote } from '../types';

const DOC_ID = 'doc-legacy-1';

function quoteDoc(): Document {
  return {
    id: DOC_ID,
    type: 'quote',
    stage: 'draft',
    total: 960,
    job: { id: 'job-1', name: 'Test job' },
  } as unknown as Document;
}

function legacyQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: DOC_ID,
    status: 'draft',
    draftStep: 'JobPreview',
    total: 960,
    updatedAt: new Date(),
    ...overrides,
  } as Quote;
}

beforeEach(() => {
  useStore.setState({
    documents: [quoteDoc()],
    quotes: [legacyQuote()],
    getNextInvoiceNumber: async () => 'INV-9',
  } as any);
});

describe('convertDocumentToInvoice legacy stamp', () => {
  it('stamps invoiceId + invoicedAt on the legacy source quote', async () => {
    const saveQuote = vi.fn(async () => {});
    useStore.setState({ saveQuote } as any);

    await useStore.getState().convertDocumentToInvoice(DOC_ID);

    expect(saveQuote).toHaveBeenCalledTimes(1);
    const stamped = saveQuote.mock.calls[0][0] as Quote;
    expect(stamped.invoiceId).toBe(DOC_ID);
    expect(stamped.invoicedAt).toBeInstanceOf(Date);
    expect(stamped.draftStep).toBeUndefined();
  });

  it('stamps BEFORE the unified doc flips to invoice (saveQuote type-guard ordering)', async () => {
    let docTypeAtStampTime: string | undefined;
    const saveQuote = vi.fn(async () => {
      docTypeAtStampTime = useStore.getState().documents.find((d) => d.id === DOC_ID)?.type;
    });
    useStore.setState({ saveQuote } as any);

    await useStore.getState().convertDocumentToInvoice(DOC_ID);

    expect(docTypeAtStampTime).toBe('quote');
    expect(useStore.getState().documents.find((d) => d.id === DOC_ID)?.type).toBe('invoice');
  });

  it('does not re-stamp a quote that already carries an invoiceId', async () => {
    useStore.setState({ quotes: [legacyQuote({ invoiceId: 'earlier-invoice' })] } as any);
    const saveQuote = vi.fn(async () => {});
    useStore.setState({ saveQuote } as any);

    await useStore.getState().convertDocumentToInvoice(DOC_ID);

    expect(saveQuote).not.toHaveBeenCalled();
  });

  it('still converts the document when the legacy stamp fails', async () => {
    const saveQuote = vi.fn(async () => { throw new Error('offline'); });
    useStore.setState({ saveQuote } as any);

    const converted = await useStore.getState().convertDocumentToInvoice(DOC_ID);

    expect(converted.type).toBe('invoice');
    expect(useStore.getState().documents.find((d) => d.id === DOC_ID)?.type).toBe('invoice');
  });
});
