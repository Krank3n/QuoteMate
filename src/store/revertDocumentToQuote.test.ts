// @vitest-environment jsdom
/**
 * Round-trip: convert a quote to an invoice, then undo it.
 *
 * The undo is only worth having if it restores what conversion overwrote.
 * Conversion replaces the quote number with a fresh invoice number and
 * subtracts the deposit credit from the total — without the stash an undo
 * would have to mint a NEW quote number, changing the customer-facing
 * reference twice, and would leave the total short by the deposit.
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

import { useStore } from './useStore';
import type { Document } from '../types/document';

const DOC_ID = 'doc-quote-1';

function quoteDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    type: 'quote',
    stage: 'quote_accepted',
    number: 'QU-178554',
    total: 1000,
    // A deposit already collected on the quote — conversion credits it
    // against the invoice total, which is the arithmetic the undo has to
    // put back.
    depositPaid: 250,
    paidTotal: 0,
    balanceDue: 1000,
    payments: [],
    job: { id: 'job-1', name: 'Lounge repaint' },
    ...overrides,
  } as unknown as Document;
}

beforeEach(() => {
  useStore.setState({
    documents: [quoteDoc()],
    quotes: [],
    invoices: [],
    getNextInvoiceNumber: vi.fn(async () => 'INV-006'),
    saveDocument: vi.fn(async (d: Document) => {
      useStore.setState((s) => ({
        documents: s.documents.map((x) => (x.id === d.id ? d : x)),
      }) as any);
    }),
  } as any);
});

describe('convert → revert round trip', () => {
  it('stashes the quote number, total and stage on conversion', async () => {
    const invoice = await useStore.getState().convertDocumentToInvoice(DOC_ID);

    expect(invoice.type).toBe('invoice');
    expect(invoice.number).toBe('INV-006');
    expect(invoice.total).toBe(750); // 1000 − 250 deposit credit
    expect(invoice.convertedFromQuote).toMatchObject({
      number: 'QU-178554',
      total: 1000,
      stage: 'quote_accepted',
    });
  });

  it('restores the original number, total and stage on undo', async () => {
    await useStore.getState().convertDocumentToInvoice(DOC_ID);
    const reverted = await useStore.getState().revertDocumentToQuote(DOC_ID);

    expect(reverted.type).toBe('quote');
    expect(reverted.number).toBe('QU-178554');
    expect(reverted.total).toBe(1000);
    expect(reverted.stage).toBe('quote_accepted');
  });

  it('clears the invoice-only fields so it reads as a quote again', async () => {
    await useStore.getState().convertDocumentToInvoice(DOC_ID);
    const reverted = await useStore.getState().revertDocumentToQuote(DOC_ID);

    expect(reverted.invoicedAt).toBeUndefined();
    expect(reverted.dueDate).toBeUndefined();
    expect(reverted.issueDate).toBeUndefined();
    expect(reverted.convertedFromQuote).toBeUndefined();
  });

  // Once the stash is spent the row must not reappear — a second undo has
  // nothing to restore and would strip a legitimately re-converted invoice.
  it('cannot be undone twice', async () => {
    await useStore.getState().convertDocumentToInvoice(DOC_ID);
    await useStore.getState().revertDocumentToQuote(DOC_ID);

    await expect(useStore.getState().revertDocumentToQuote(DOC_ID)).rejects.toThrow();
  });

  it('refuses once money has landed on the invoice, even mid-session', async () => {
    await useStore.getState().convertDocumentToInvoice(DOC_ID);
    // A webhook lands a payment between the sheet rendering and the tap.
    useStore.setState((s) => ({
      documents: s.documents.map((d) =>
        d.id === DOC_ID ? { ...d, paidTotal: 100 } : d,
      ),
    }) as any);

    await expect(useStore.getState().revertDocumentToQuote(DOC_ID)).rejects.toThrow();
  });

  it('refuses on a document that was never converted', async () => {
    await expect(useStore.getState().revertDocumentToQuote(DOC_ID)).rejects.toThrow();
  });
});
