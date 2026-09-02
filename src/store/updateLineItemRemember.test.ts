// @vitest-environment jsdom
/**
 * A price the tradie gives Mate ("the decking's $8.50 a metre") is remembered
 * in the Supplier Book, so the next quote starts from their number.
 *
 * The write is deliberately AFTER the document save and fire-and-forget: the
 * edit the tradie approved must land even if the book write fails, and a
 * quantity-only or rename-only edit carries no price worth remembering.
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
// behaviour matters here.
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

const remember = vi.hoisted(() => ({ rememberMaterialPrice: vi.fn(async () => true) }));
// The store reaches priceMemory through a dynamic import; vi.mock covers that too.
vi.mock('../services/priceMemory', () => ({ rememberMaterialPrice: remember.rememberMaterialPrice }));

import { useStore } from './useStore';
import type { Document } from '../types/document';
import type { Material } from '../types';

const DOC_ID = 'doc-quote-1';

function row(extra: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    name: 'Merbau decking 90x19',
    quantity: 40,
    unit: 'm',
    price: 6.2,
    totalPrice: 248,
    manualPriceOverride: false,
    pricingSource: 'ai',
    priceConfidence: 'low',
    origin: 'recommended',
    ...extra,
  } as Material;
}

function quoteDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    type: 'quote',
    stage: 'draft',
    number: 'QU-001',
    materials: [row()],
    job: { id: 'job-1', name: 'Back deck' },
    ...overrides,
  } as unknown as Document;
}

const base = { id: 'p1', toolUseId: 't1', createdAt: '2026-09-02T00:00:00Z' };

beforeEach(() => {
  remember.rememberMaterialPrice.mockClear();
  useStore.setState({
    documents: [quoteDoc()],
    invoices: [],
    quotes: [],
    contacts: [],
    currentQuote: null,
    subscriptionStatus: { plan: 'pro' },
    saveDocument: vi.fn(async (d: Document) => {
      useStore.setState((s) => ({
        documents: s.documents.map((x) => (x.id === d.id ? d : x)),
      }) as any);
    }),
  } as any);
});

describe('propose_update_line_item remembers the price', () => {
  it('saves the edited row to the supplier book after the document save', async () => {
    const result = await useStore.getState().applyProposal({
      ...base,
      type: 'propose_update_line_item',
      quoteId: DOC_ID,
      materialId: 'm1',
      price: 8.5,
    });
    expect(result.ok).toBe(true);

    const saved = useStore.getState().documents[0].materials![0];
    expect(saved.price).toBe(8.5);
    expect(saved.totalPrice).toBe(340);
    expect(saved.pricingSource).toBe('manual');

    await vi.waitFor(() => expect(remember.rememberMaterialPrice).toHaveBeenCalledTimes(1));
    const remembered = remember.rememberMaterialPrice.mock.calls[0][0] as Material;
    expect(remembered).toMatchObject({ id: 'm1', name: 'Merbau decking 90x19', price: 8.5, pricingSource: 'manual' });
  });

  it('remembers nothing for a quantity-only or rename-only edit', async () => {
    await useStore.getState().applyProposal({
      ...base,
      type: 'propose_update_line_item',
      quoteId: DOC_ID,
      materialId: 'm1',
      quantity: 44,
    });
    await useStore.getState().applyProposal({
      ...base,
      type: 'propose_update_line_item',
      quoteId: DOC_ID,
      materialId: 'm1',
      name: 'Merbau decking 90x19 (select grade)',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(remember.rememberMaterialPrice).not.toHaveBeenCalled();
    expect(useStore.getState().documents[0].materials![0].quantity).toBe(44);
  });

  it('a row that is no longer on the quote saves nothing and remembers nothing', async () => {
    const result = await useStore.getState().applyProposal({
      ...base,
      type: 'propose_update_line_item',
      quoteId: DOC_ID,
      materialId: 'gone',
      price: 8.5,
    });
    expect(result.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(remember.rememberMaterialPrice).not.toHaveBeenCalled();
  });

  it('the edit still lands when the book write fails', async () => {
    remember.rememberMaterialPrice.mockRejectedValueOnce(new Error('offline'));
    const result = await useStore.getState().applyProposal({
      ...base,
      type: 'propose_update_line_item',
      quoteId: DOC_ID,
      materialId: 'm1',
      price: 9,
    });
    expect(result.ok).toBe(true);
    expect(useStore.getState().documents[0].materials![0].price).toBe(9);
    await vi.waitFor(() => expect(remember.rememberMaterialPrice).toHaveBeenCalledTimes(1));
  });
});
