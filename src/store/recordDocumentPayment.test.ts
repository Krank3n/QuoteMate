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
import { depositOwed } from '../utils/nextBestAction';
import { depositHasBeenPaid } from '../../shared/job/stage';

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

  it('labels a payment as the deposit without changing the money', async () => {
    const updated = await useStore
      .getState()
      .recordDocumentPayment(DOC_ID, 200, 'bank_transfer', undefined, undefined, true);

    expect(updated.payments).toHaveLength(1);
    expect(updated.payments[0]).toMatchObject({ kind: 'manual', amount: 200, isDeposit: true });
    expect(updated.paidTotal).toBeCloseTo(200);
    expect(updated.stage).toBe('partially_paid');
  });

  it('leaves the deposit label off an ordinary payment', async () => {
    const updated = await useStore.getState().recordDocumentPayment(DOC_ID, 200, 'cash');
    expect('isDeposit' in updated.payments[0]).toBe(false);
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

  // Was: "keeps the legacy row in step when one actually exists", asserting
  // that the legacy recordPayment ALSO ran. That turned out to be the bug —
  // saveDocument's mirror already writes the legacy row with an absolute
  // paidAmount, and legacy recordPayment is additive, so the pair doubled
  // every payment. See documentPaymentLedger.test.ts.
  it('leaves the additive legacy recordPayment alone — the mirror already covers it', async () => {
    const recordPayment = vi.fn(async () => {});
    useStore.setState({
      invoices: [{ id: LEGACY_ID, total: 694.06, paidAmount: 0 }],
      recordPayment,
    } as any);

    const updated = await useStore
      .getState()
      .recordDocumentPayment(DOC_ID, 694.06, 'bank_transfer');

    expect(recordPayment).not.toHaveBeenCalled();
    expect(updated.paidTotal).toBeCloseTo(694.06);
  });

  it('still records the payment when the legacy mirror write throws', async () => {
    useStore.setState({
      invoices: [{ id: LEGACY_ID, total: 694.06, paidAmount: 0 }],
      recordPayment: vi.fn(async () => { throw new Error('Invoice not found'); }),
    } as any);

    const updated = await useStore.getState().recordDocumentPayment(DOC_ID, 694.06, 'cash');

    expect(updated.stage).toBe('paid');
  });

});

// A tradie who isn't on Square is paid the deposit by bank transfer and
// records it on the quote. It has to behave like a Square deposit: a
// `kind: 'deposit'` entry (the only kind the quote's legacy mirror round-trips,
// via depositPaid), the quote accepted, and nothing marked paid.
describe('recordDocumentPayment on a quote records the deposit', () => {
  const QUOTE_ID = 'quote-coastal-1';
  const quoteDoc = (overrides: Partial<Document> = {}): Document =>
    ({
      id: QUOTE_ID,
      type: 'quote',
      stage: 'quote_sent',
      number: 'QU-021',
      total: 960,
      requireDeposit: true,
      depositAmount: 300,
      paidTotal: 0,
      balanceDue: 960,
      payments: [],
      job: { id: 'job-1', name: 'Coastal Concreting driveway' },
      ...overrides,
    }) as unknown as Document;
  const stored = () => useStore.getState().documents.find((d) => d.id === QUOTE_ID)!;

  beforeEach(() => {
    useStore.setState({ documents: [quoteDoc()] } as any);
  });

  it('appends a deposit entry with the chosen method and no Square id', async () => {
    await useStore.getState().recordDocumentPayment(QUOTE_ID, 300, 'bank_transfer', 'Ref SAM300');

    const [entry] = stored().payments;
    expect(entry).toMatchObject({ kind: 'deposit', amount: 300, method: 'bank', notes: 'Ref SAM300' });
    expect(entry.squarePaymentId).toBeUndefined();
    // Not the invoice label — the kind already says deposit.
    expect(entry.isDeposit).toBeUndefined();
  });

  it('keeps depositPaid, paidTotal and balanceDue in step with the ledger', async () => {
    await useStore.getState().recordDocumentPayment(QUOTE_ID, 300, 'cash', undefined, new Date(1_700_000_000_000));

    expect(stored().depositPaid).toBe(300);
    expect(stored().depositPaidAt).toBe(1_700_000_000_000);
    expect(stored().paidTotal).toBe(300);
    expect(stored().balanceDue).toBe(660);
  });

  it('"Take Deposit" stops being offered once the deposit asked for is recorded', async () => {
    expect(depositOwed(stored())).toBe(true);

    await useStore.getState().recordDocumentPayment(QUOTE_ID, 300, 'bank_transfer');

    expect(depositOwed(stored())).toBe(false);
    expect(depositHasBeenPaid(stored())).toBe(true);
  });

  it('part of the deposit leaves "Take Deposit" up for the rest', async () => {
    await useStore.getState().recordDocumentPayment(QUOTE_ID, 100, 'bank_transfer');
    expect(depositOwed(stored())).toBe(true);
  });

  it('moves a sent quote to accepted — never paid or partially paid', async () => {
    const updated = await useStore.getState().recordDocumentPayment(QUOTE_ID, 300, 'bank_transfer');

    expect(updated.stage).toBe('quote_accepted');
    expect(updated.acceptedAt).toBeGreaterThan(0);
  });

  it('accepts a draft quote too, exactly like a Square deposit', async () => {
    useStore.setState({ documents: [quoteDoc({ stage: 'draft' })] } as any);

    const updated = await useStore.getState().recordDocumentPayment(QUOTE_ID, 300, 'bank_transfer');

    expect(updated.stage).toBe('quote_accepted');
  });

  it('caps the deposit at what the quote still owes', async () => {
    const updated = await useStore.getState().recordDocumentPayment(QUOTE_ID, 5000, 'cash');

    expect(updated.payments[0].amount).toBe(960);
    expect(updated.depositPaid).toBe(960);
    expect(updated.stage).toBe('quote_accepted');
  });

  it('adds a second deposit to the first', async () => {
    useStore.setState({
      documents: [quoteDoc({
        stage: 'quote_accepted',
        payments: [{ id: 'd1', kind: 'deposit', amount: 100, paidAt: 1, method: 'bank' }],
        paidTotal: 100,
        depositPaid: 100,
      } as any)],
    } as any);

    await useStore.getState().recordDocumentPayment(QUOTE_ID, 200, 'cash');

    expect(stored().depositPaid).toBe(300);
    expect(stored().paidTotal).toBe(300);
    expect(stored().payments).toHaveLength(2);
  });

  it('editing the deposit re-derives depositPaid, and it stays editable', async () => {
    await useStore.getState().recordDocumentPayment(QUOTE_ID, 300, 'bank_transfer');
    const id = stored().payments[0].id;

    await useStore.getState().updateDocumentPayment(QUOTE_ID, id, { amount: 250 });

    expect(stored().depositPaid).toBe(250);
    expect(stored().paidTotal).toBe(250);
    expect(stored().balanceDue).toBe(710);
    expect(stored().stage).toBe('quote_accepted');
  });

  it('removing the deposit clears depositPaid but leaves the quote accepted', async () => {
    await useStore.getState().recordDocumentPayment(QUOTE_ID, 300, 'bank_transfer');
    const id = stored().payments[0].id;

    await useStore.getState().deleteDocumentPayment(QUOTE_ID, id);

    expect(stored().depositPaid).toBe(0);
    expect(stored().paidTotal).toBe(0);
    expect(stored().balanceDue).toBe(960);
    expect(stored().stage).toBe('quote_accepted');
  });

  it('a Square deposit on the quote stays read-only', async () => {
    useStore.setState({
      documents: [quoteDoc({
        stage: 'quote_accepted',
        payments: [{ id: 'deposit-sq-1', kind: 'deposit', amount: 300, paidAt: 1, method: 'square', squarePaymentId: 'sq-1' }],
        paidTotal: 300,
        depositPaid: 300,
      } as any)],
    } as any);

    await expect(
      useStore.getState().updateDocumentPayment(QUOTE_ID, 'deposit-sq-1', { amount: 100 }),
    ).rejects.toThrow(/Square/);
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
