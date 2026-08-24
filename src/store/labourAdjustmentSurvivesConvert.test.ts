// @vitest-environment jsdom
/**
 * Regression: a labour adjustment must survive quote -> invoice.
 *
 * Aug 2026 (Coastal HVAC, INV-003). The tradie trimmed labour on a job —
 * sections summed to $240, a -$60 "Labour adjustment" brought labour to $180
 * and the invoice to $430.10, which is what the app showed him. The PDF his
 * customer received said $496.10.
 *
 * Cause: createInvoiceFromQuote copied laborTotal and sections but not
 * laborExtraHours. laborTotal is a DERIVED field —
 * Σ(sections) + laborExtraHours × laborRate — so the invoice landed with
 * fields that contradicted its own total. The next recompute (updateInvoice,
 * or any recalc on the send path) recomputed labour as Σ(sections) = $240 and
 * "corrected" the total upward by exactly the amount he had discounted,
 * re-billing the customer for labour he had deliberately taken off.
 *
 * The adjustment is money, so it is carried like money.
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
import type { Quote, Invoice } from '../types';

/** Jake's job: $240 of sections, trimmed by $60, on $211 of materials. */
function trimmedLabourQuote(): Quote {
  return {
    id: 'q-hvac',
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
    customerName: 'Coastal client',
    job: { id: 'job-hvac', name: 'HVAC Chemical Treatment', description: '', template: 'custom' },
    materials: [
      { id: 'm1', name: 'Coil clean', quantity: 1, unit: 'each', price: 31, totalPrice: 31 },
      { id: 'm2', name: 'Call out inc first 30 min', quantity: 1, unit: 'each', price: 180, totalPrice: 180 },
    ],
    materialsSubtotal: 211,
    laborRate: 120,
    laborHours: 1.5,
    laborUnit: 'hours',
    // Σ(sections) $240 + (-0.5h × $120) = $180
    laborTotal: 180,
    laborExtraHours: -0.5,
    sections: [
      { id: 's1', name: 'HVAC Chemical Treatment', laborHours: 2, multiplier: 1, laborHoursTotal: 2, laborRate: 120, laborUnit: 'hours', laborTotal: 240 },
      { id: 's2', name: 'Testing & Site Cleanup', laborHours: 0, multiplier: 1, laborHoursTotal: 0, laborRate: 120, laborUnit: 'hours', laborTotal: 0 },
    ],
    markup: 0,
    laborMarkup: 0,
    markupAmount: 0,
    subtotal: 391,
    gst: 39.10,
    total: 430.10,
    gstRegistered: true,
    pricesIncludeGst: false,
  } as unknown as Quote;
}

// The real saveQuote, captured before any test stubs it. The re-route test
// below needs the actual implementation (that is what is under test), while
// the convert tests stub it out to keep createInvoiceFromQuote's back-ref
// stamp from doing real work.
const realSaveQuote = useStore.getState().saveQuote;

describe('a trimmed labour figure survives quote -> invoice', () => {
  beforeEach(() => {
    useStore.setState({
      documents: [],
      quotes: [],
      invoices: [],
      getNextInvoiceNumber: async () => 'INV-003',
      saveInvoice: async () => {},
      saveQuote: async () => {},
    } as any);
  });

  it('carries laborExtraHours onto the new invoice', async () => {
    const quote = trimmedLabourQuote();
    useStore.setState({ quotes: [quote] } as any);

    const invoice = await useStore.getState().createInvoiceFromQuote(quote);

    expect(invoice.laborExtraHours).toBe(-0.5);
    expect(invoice.laborTotal).toBe(180);
  });

  it('keeps the total at $430.10 after the invoice is recomputed', async () => {
    const quote = trimmedLabourQuote();
    useStore.setState({ quotes: [quote] } as any);

    const invoice = await useStore.getState().createInvoiceFromQuote(quote);

    // updateInvoice re-derives labour from sections + extra. Before the fix
    // this recomputed $240 of labour and inflated the total to $496.10.
    useStore.getState().updateInvoice(invoice as Invoice);
    const recomputed = useStore.getState().currentInvoice!;

    expect(recomputed.laborTotal).toBe(180);
    expect(recomputed.total).toBeCloseTo(430.10, 2);
  });

  it('does not inflate labour when the wizard re-routes a quote save onto the invoice', async () => {
    const quote = trimmedLabourQuote();
    // The stored invoice deliberately carries a STALE adjustment (0 — i.e. the
    // shape the old convert bug produced). The re-route must overwrite it from
    // the quote being saved; spreading the quote here would let the assertion
    // pass on the inherited value and prove nothing.
    const existingInvoice = {
      ...quote,
      id: quote.id,
      laborExtraHours: 0,
      laborTotal: 240,
      invoiceNumber: 'INV-003',
      status: 'draft',
      paymentTerms: 'net_14',
    } as unknown as Invoice;

    const saved: Invoice[] = [];
    useStore.setState({
      quotes: [quote],
      invoices: [existingInvoice],
      documents: [{ id: quote.id, type: 'invoice', stage: 'draft' } as any],
      saveInvoice: async (inv: Invoice) => { saved.push(inv); },
      saveQuote: realSaveQuote,
    } as any);

    await useStore.getState().saveQuote(quote);

    expect(saved).toHaveLength(1);
    expect(saved[0].laborExtraHours).toBe(-0.5);
  });
});
