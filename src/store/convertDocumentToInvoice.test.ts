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

// A deposit the customer already paid on the quote must come off the invoice
// as a credit, on both conversion paths. This is the invoice a tradie creates
// from the "job won" sheet / sticky bar's Create Invoice straight after a
// deposit landed — billing the full total again would double-charge the
// customer for the deposit they just paid.
describe('a paid deposit is carried as a credit on the invoice', () => {
  const NOW = 1_700_000_000_000;
  const quoteWithDeposit = (): Quote =>
    legacyQuote({
      status: 'accepted',
      total: 960,
      materials: [],
      job: { id: 'job-1', name: 'Test job' },
      depositAmount: 300,
      depositPaid: 300,
      depositPaidAt: new Date(NOW),
    } as Partial<Quote>);
  const acceptedDoc = (): Document =>
    ({ ...quoteDoc(), stage: 'quote_accepted', materials: [], depositAmount: 300, depositPaid: 300 }) as Document;

  it('legacy createInvoiceFromQuote: total drops by the deposit and the credit is stamped', async () => {
    // No unified doc for this id → the legacy mint path runs.
    useStore.setState({ documents: [], quotes: [quoteWithDeposit()], saveQuote: vi.fn(async () => {}) } as any);

    const invoice = await useStore.getState().createInvoiceFromQuote(quoteWithDeposit());

    expect(invoice.total).toBe(660);
    expect(invoice.depositCredit).toBe(300);
    expect(invoice.depositCreditFromQuoteId).toBe(DOC_ID);
    expect(invoice.sourceQuoteId).toBe(DOC_ID);
  });

  it('legacy createInvoiceFromQuote: credits only money actually received, not the deposit asked for', async () => {
    useStore.setState({ documents: [], quotes: [], saveQuote: vi.fn(async () => {}) } as any);
    const unpaid = legacyQuote({
      status: 'accepted',
      total: 960,
      materials: [],
      job: { id: 'job-1', name: 'Test job' },
      depositAmount: 300,
      depositPaid: 0,
    } as Partial<Quote>);

    const invoice = await useStore.getState().createInvoiceFromQuote(unpaid);

    expect(invoice.total).toBe(960);
    expect(invoice.depositCredit).toBeUndefined();
  });

  it('unified convertDocumentToInvoice: total drops by the deposit and the deposit stays on the doc', async () => {
    useStore.setState({
      documents: [acceptedDoc()],
      quotes: [quoteWithDeposit()],
      saveQuote: vi.fn(async () => {}),
    } as any);

    const converted = await useStore.getState().convertDocumentToInvoice(DOC_ID);

    expect(converted.type).toBe('invoice');
    expect(converted.total).toBe(660);
    expect(converted.depositPaid).toBe(300);
    // The undo stash keeps the pre-credit total so a revert restores it.
    expect(converted.convertedFromQuote?.total).toBe(960);
  });

  it('createInvoiceFromQuote routes an accepted quote with a unified doc through the same credit', async () => {
    useStore.setState({
      documents: [acceptedDoc()],
      quotes: [quoteWithDeposit()],
      saveQuote: vi.fn(async () => {}),
    } as any);

    const invoice = await useStore.getState().createInvoiceFromQuote(quoteWithDeposit());

    expect(invoice.total).toBe(660);
    expect(useStore.getState().documents.find((d) => d.id === DOC_ID)?.total).toBe(660);
  });
});

describe('createInvoiceFromQuote never mints a ghost job', () => {
  // 13 Sep 2026: a throw inside the unified branch fell through to the legacy
  // mint, whose invoice carries no jobId. The server's job-sync safety net then
  // materialised a second Job, repointed the document to it, and the tradie's
  // real job showed "No quote yet" right after they tapped Create Invoice.
  const accepted = (): Quote =>
    legacyQuote({ status: 'accepted', total: 960, materials: [], jobId: 'job-real', job: { id: 'job-1', name: 'Test job' } } as Partial<Quote>);

  it('surfaces a unified-path failure instead of falling back to the legacy mint', async () => {
    const saveInvoice = vi.fn(async () => {});
    useStore.setState({
      documents: [{ ...quoteDoc(), stage: 'quote_accepted', materials: [] } as Document],
      quotes: [accepted()],
      invoices: [],
      currentInvoice: null,
      saveQuote: vi.fn(async () => {}),
      saveInvoice,
      getNextInvoiceNumber: async () => { throw new Error('numbering service down'); },
    } as any);

    await expect(useStore.getState().createInvoiceFromQuote(accepted())).rejects.toThrow('numbering service down');

    // Nothing minted on the side: no legacy invoice, no currentInvoice, and
    // the unified document is still the quote it was.
    expect(saveInvoice).not.toHaveBeenCalled();
    expect(useStore.getState().currentInvoice).toBeNull();
    expect(useStore.getState().documents.find((d) => d.id === DOC_ID)?.type).toBe('quote');
  });

  it('the adapter copes with a quote that has never taken a payment (the throw that triggered the fallback)', async () => {
    useStore.setState({
      documents: [{ ...quoteDoc(), stage: 'quote_accepted', materials: [], payments: undefined } as unknown as Document],
      quotes: [accepted()],
      invoices: [],
      currentInvoice: null,
      saveQuote: vi.fn(async () => {}),
      getNextInvoiceNumber: async () => 'INV-9',
    } as any);

    const invoice = await useStore.getState().createInvoiceFromQuote(accepted());

    expect(invoice.id).toBe(DOC_ID);
    expect(useStore.getState().documents.find((d) => d.id === DOC_ID)?.type).toBe('invoice');
  });

  it('the legacy mint (no unified doc) stays on the quote\'s Job', async () => {
    useStore.setState({ documents: [], quotes: [accepted()], saveQuote: vi.fn(async () => {}) } as any);

    const invoice = await useStore.getState().createInvoiceFromQuote(accepted());

    expect(invoice.jobId).toBe('job-real');
  });
});
