// @vitest-environment jsdom
/**
 * Regression tests for recordDocumentPayment — the fix for "Invoice not found".
 *
 * Aug 2026: a tradie tried three times to mark a bank transfer as received and
 * got "Invoice not found" every time (Mate conversation 2026-08-03T16:46Z).
 * Cause: propose_mark_paid routed through the legacy `recordPayment`, which
 * only searches the `invoices` array. That array is never loaded at bootstrap
 * (App.tsx loads quotes + documents, not invoices), and after a quote is
 * converted the Document keeps the quote's id while its legacy mirror gets a
 * fresh one — so the lookup missed on both counts. Payments now write the
 * unified ledger, which is the id-space the app actually keeps loaded.
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

const DOC_ID = 'doc-converted-1';
const LEGACY_ID = 'legacy-invoice-9';

// The real-world shape that broke: a quote converted to an invoice keeps the
// quote's id, while the legacy mirror it spawned carries a different one.
function invoiceDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    legacyInvoiceId: LEGACY_ID,
    type: 'invoice',
    stage: 'invoice_sent',
    number: 'INV-004',
    total: 694.06,
    paidTotal: 0,
    balanceDue: 694.06,
    payments: [],
    job: { id: 'job-1', name: 'Rodent service' },
    ...overrides,
  } as unknown as Document;
}

beforeEach(() => {
  useStore.setState({
    documents: [invoiceDoc()],
    // Empty on purpose — this is the real bootstrap state. loadInvoices() is
    // never called on app start, so nothing populates it.
    invoices: [],
    quotes: [],
    saveDocument: vi.fn(async (d: Document) => {
      useStore.setState((s) => ({
        documents: s.documents.map((x) => (x.id === d.id ? d : x)),
      }) as any);
    }),
  } as any);
});

describe('recordDocumentPayment', () => {
  it('records a payment when the legacy invoices array is empty', async () => {
    const updated = await useStore
      .getState()
      .recordDocumentPayment(DOC_ID, 694.06, 'bank_transfer');

    expect(updated.paidTotal).toBeCloseTo(694.06);
    expect(updated.balanceDue).toBe(0);
    expect(updated.stage).toBe('paid');
    expect(updated.payments).toHaveLength(1);
    expect(updated.payments[0].method).toBe('bank');
    expect(updated.payments[0].kind).toBe('manual');
  });

  it('resolves a doc addressed by its legacy invoice id', async () => {
    const updated = await useStore
      .getState()
      .recordDocumentPayment(LEGACY_ID, 694.06, 'cash');

    expect(updated.id).toBe(DOC_ID);
    expect(updated.stage).toBe('paid');
  });

  it('marks the doc partially_paid when the balance is not cleared', async () => {
    const updated = await useStore.getState().recordDocumentPayment(DOC_ID, 200, 'cash');

    expect(updated.paidTotal).toBe(200);
    expect(updated.balanceDue).toBeCloseTo(494.06);
    expect(updated.stage).toBe('partially_paid');
  });

  it('caps a payment at the outstanding balance', async () => {
    useStore.setState({
      documents: [invoiceDoc({ paidTotal: 600, balanceDue: 94.06, payments: [
        { id: 'p0', kind: 'deposit', amount: 600, paidAt: 1 },
      ] as any })],
    } as any);

    const updated = await useStore.getState().recordDocumentPayment(DOC_ID, 999, 'cash');

    expect(updated.paidTotal).toBeCloseTo(694.06);
    expect(updated.balanceDue).toBe(0);
  });

  it('keeps the legacy row in step when one actually exists', async () => {
    const recordPayment = vi.fn(async () => {});
    useStore.setState({
      invoices: [{ id: LEGACY_ID, total: 694.06, paidAmount: 0 }],
      recordPayment,
    } as any);

    await useStore.getState().recordDocumentPayment(DOC_ID, 694.06, 'bank_transfer');

    expect(recordPayment).toHaveBeenCalledWith(
      LEGACY_ID, 694.06, 'bank_transfer', undefined, undefined,
    );
  });

  it('still records the payment when the legacy mirror write throws', async () => {
    useStore.setState({
      invoices: [{ id: LEGACY_ID, total: 694.06, paidAmount: 0 }],
      recordPayment: vi.fn(async () => { throw new Error('Invoice not found'); }),
    } as any);

    const updated = await useStore.getState().recordDocumentPayment(DOC_ID, 694.06, 'cash');

    expect(updated.stage).toBe('paid');
  });

  it('refuses to bank money against a quote', async () => {
    useStore.setState({ documents: [invoiceDoc({ type: 'quote' } as any)] } as any);

    await expect(
      useStore.getState().recordDocumentPayment(DOC_ID, 100, 'cash'),
    ).rejects.toThrow(/quote, not an invoice/);
  });
});

describe('propose_mark_paid apply', () => {
  it('marks a converted invoice paid without touching the legacy array', async () => {
    const result = await useStore.getState().applyProposal({
      id: 'prop-1',
      toolUseId: 'tool-1',
      createdAt: new Date().toISOString(),
      type: 'propose_mark_paid',
      quoteId: DOC_ID,
      method: 'bank_transfer',
    } as any);

    expect(result.ok).toBe(true);
    expect(useStore.getState().documents[0].stage).toBe('paid');
    expect(useStore.getState().documents[0].paidTotal).toBeCloseTo(694.06);
  });

  it('reports an already-settled invoice instead of erroring', async () => {
    useStore.setState({
      documents: [invoiceDoc({ paidTotal: 694.06, balanceDue: 0, stage: 'paid' })],
    } as any);

    const result = await useStore.getState().applyProposal({
      id: 'prop-2',
      toolUseId: 'tool-2',
      createdAt: new Date().toISOString(),
      type: 'propose_mark_paid',
      quoteId: DOC_ID,
    } as any);

    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/already paid in full/);
  });
});
