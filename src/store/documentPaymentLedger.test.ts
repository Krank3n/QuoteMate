// @vitest-environment jsdom
/**
 * Aug 2026: recording a $960 payment on a $960 invoice produced
 * "Overpaid $1,920.00 / $960.00" — one ledger entry, doubled.
 *
 * recordDocumentPayment wrote the payment down two paths that both landed on
 * the legacy invoice row: saveDocument's mirror set `paidAmount` ABSOLUTELY,
 * then the legacy recordPayment ADDED the same amount on top of it
 * (`currentPaid + amount`). onInvoiceWritten projected the doubled legacy
 * total back over the unified ledger as a single inflated payment.
 *
 * The input caps in recordDocumentPayment and RecordPaymentScreen both run
 * BEFORE the mirror, which is why neither caught it.
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

const DOC_ID = 'doc-invoice-1';
const LEGACY_ID = 'legacy-invoice-1';

function invoiceDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    legacyInvoiceId: LEGACY_ID,
    type: 'invoice',
    stage: 'invoice_sent',
    number: 'INV-006',
    total: 960,
    paidTotal: 0,
    balanceDue: 960,
    payments: [],
    sentAt: 1_700_000_000_000,
    job: { id: 'job-1', name: 'Custom Job' },
    ...overrides,
  } as unknown as Document;
}

/** The legacy row whose presence used to trigger the additive second write. */
function legacyInvoice(paidAmount = 0): any {
  return { id: LEGACY_ID, total: 960, paidAmount, status: 'sent', customerName: 'Someone' };
}

let recordPaymentSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  recordPaymentSpy = vi.fn(async () => {});
  useStore.setState({
    documents: [invoiceDoc()],
    invoices: [legacyInvoice()],
    quotes: [],
    recordPayment: recordPaymentSpy,
    saveDocument: vi.fn(async (d: Document) => {
      useStore.setState((s) => ({
        documents: s.documents.map((x) => (x.id === d.id ? d : x)),
      }) as any);
    }),
  } as any);
});

describe('recordDocumentPayment — the doubling regression', () => {
  it('REGRESSION: a full payment lands once, even with a legacy row present', async () => {
    const updated = await useStore
      .getState()
      .recordDocumentPayment(DOC_ID, 960, 'bank_transfer');

    expect(updated.paidTotal).toBe(960);
    expect(updated.balanceDue).toBe(0);
    expect(updated.stage).toBe('paid');
    expect(updated.payments).toHaveLength(1);
  });

  // saveDocument's mirror already writes the legacy row with an absolute
  // paidAmount. The legacy recordPayment is additive, so calling it too read
  // that value back and added the payment a second time.
  it('does not also push through the additive legacy recordPayment', async () => {
    await useStore.getState().recordDocumentPayment(DOC_ID, 960, 'bank_transfer');
    expect(recordPaymentSpy).not.toHaveBeenCalled();
  });

  it('still lands once when no legacy row exists', async () => {
    useStore.setState({ invoices: [] } as any);
    const updated = await useStore.getState().recordDocumentPayment(DOC_ID, 400, 'cash');
    expect(updated.paidTotal).toBe(400);
    expect(updated.stage).toBe('partially_paid');
  });
});

describe('updateDocumentPayment', () => {
  it('repairs an inflated payment and flips the doc off overpaid', async () => {
    // The exact broken shape seen in production.
    useStore.setState({
      documents: [
        invoiceDoc({
          stage: 'paid',
          paidTotal: 1920,
          balanceDue: 0,
          payments: [{ id: 'p1', kind: 'manual', amount: 1920, paidAt: 1, method: 'bank' }],
        } as any),
      ],
    } as any);

    const updated = await useStore
      .getState()
      .updateDocumentPayment(DOC_ID, 'p1', { amount: 960 });

    expect(updated.paidTotal).toBe(960);
    expect(updated.balanceDue).toBe(0);
    expect(updated.stage).toBe('paid');
  });

  it('drops a fully-paid invoice back to partially paid when the amount is reduced', async () => {
    useStore.setState({
      documents: [
        invoiceDoc({
          stage: 'paid',
          paidTotal: 960,
          payments: [{ id: 'p1', kind: 'manual', amount: 960, paidAt: 1, method: 'cash' }],
        } as any),
      ],
    } as any);

    const updated = await useStore.getState().updateDocumentPayment(DOC_ID, 'p1', { amount: 400 });

    expect(updated.paidTotal).toBe(400);
    expect(updated.balanceDue).toBe(560);
    expect(updated.stage).toBe('partially_paid');
  });

  it('caps an edit at the balance excluding the payment being edited', async () => {
    useStore.setState({
      documents: [
        invoiceDoc({
          stage: 'partially_paid',
          paidTotal: 700,
          payments: [
            { id: 'p1', kind: 'manual', amount: 400, paidAt: 1, method: 'cash' },
            { id: 'p2', kind: 'manual', amount: 300, paidAt: 2, method: 'bank' },
          ],
        } as any),
      ],
    } as any);

    // p1 may grow to 960 − 300 = 660, no further.
    const updated = await useStore.getState().updateDocumentPayment(DOC_ID, 'p1', { amount: 5000 });

    expect(updated.paidTotal).toBe(960);
    expect(updated.payments.find((p) => p.id === 'p1')!.amount).toBe(660);
  });

  it('carries the date, method and notes through', async () => {
    useStore.setState({
      documents: [
        invoiceDoc({
          paidTotal: 100,
          payments: [{ id: 'p1', kind: 'manual', amount: 100, paidAt: 1, method: 'cash' }],
        } as any),
      ],
    } as any);

    const updated = await useStore.getState().updateDocumentPayment(DOC_ID, 'p1', {
      paidAt: 42,
      method: 'bank',
      notes: 'ref 12345',
    });
    const p = updated.payments.find((x) => x.id === 'p1')!;

    expect(p.paidAt).toBe(42);
    expect(p.method).toBe('bank');
    expect(p.notes).toBe('ref 12345');
    expect(p.amount).toBe(100); // untouched when no amount is given
  });

  it('refuses a Square payment — that record belongs to Square', async () => {
    useStore.setState({
      documents: [
        invoiceDoc({
          paidTotal: 960,
          payments: [
            { id: 'sq', kind: 'balance', amount: 960, paidAt: 1, method: 'square', squarePaymentId: 'sq_1' },
          ],
        } as any),
      ],
    } as any);

    await expect(
      useStore.getState().updateDocumentPayment(DOC_ID, 'sq', { amount: 1 }),
    ).rejects.toThrow();
  });
});

describe('deleteDocumentPayment', () => {
  it('zeroes the ledger and returns the invoice to unpaid-but-sent', async () => {
    useStore.setState({
      documents: [
        invoiceDoc({
          stage: 'paid',
          paidTotal: 960,
          payments: [{ id: 'p1', kind: 'manual', amount: 960, paidAt: 1, method: 'cash' }],
        } as any),
      ],
    } as any);

    const updated = await useStore.getState().deleteDocumentPayment(DOC_ID, 'p1');

    expect(updated.payments).toHaveLength(0);
    expect(updated.paidTotal).toBe(0);
    expect(updated.balanceDue).toBe(960);
    expect(updated.stage).toBe('invoice_sent');
  });

  it('leaves the other payments alone', async () => {
    useStore.setState({
      documents: [
        invoiceDoc({
          stage: 'partially_paid',
          paidTotal: 700,
          payments: [
            { id: 'p1', kind: 'manual', amount: 400, paidAt: 1, method: 'cash' },
            { id: 'p2', kind: 'manual', amount: 300, paidAt: 2, method: 'bank' },
          ],
        } as any),
      ],
    } as any);

    const updated = await useStore.getState().deleteDocumentPayment(DOC_ID, 'p1');

    expect(updated.payments.map((p) => p.id)).toEqual(['p2']);
    expect(updated.paidTotal).toBe(300);
  });

  it('refuses a Square payment', async () => {
    useStore.setState({
      documents: [
        invoiceDoc({
          paidTotal: 960,
          payments: [
            { id: 'sq', kind: 'balance', amount: 960, paidAt: 1, method: 'square', squarePaymentId: 'sq_1' },
          ],
        } as any),
      ],
    } as any);

    await expect(useStore.getState().deleteDocumentPayment(DOC_ID, 'sq')).rejects.toThrow();
  });
});
