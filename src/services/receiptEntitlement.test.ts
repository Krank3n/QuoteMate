import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The behaviour under test is the one the Jul-2026 outage exposed: a purchase
 * that cannot be verified must stay UNFINISHED so the store hands it back,
 * while a verified or disowned one must be finished so it stops coming back.
 * Getting 'retry' wrong in either direction either burns a real payment or
 * loops a dead receipt forever.
 */

// vi.mock is hoisted above normal declarations, so the shared handles have to
// be created inside vi.hoisted to exist by the time the factories run.
const h = vi.hoisted(() => ({
  auth: { currentUser: null as any },
  finishTransaction: vi.fn(),
  getRecoverablePurchases: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../config/firebase', () => ({ auth: h.auth }));
vi.mock('./billingService', () => ({
  billingService: {
    initialize: vi.fn().mockResolvedValue(true),
    finishTransaction: h.finishTransaction,
    getRecoverablePurchases: h.getRecoverablePurchases,
  },
}));

const mockAuth = h.auth;
const finishTransaction = h.finishTransaction;
const getRecoverablePurchases = h.getRecoverablePurchases;

import {
  validatePurchase,
  recoverPendingPurchases,
  claimPurchase,
  releasePurchase,
  purchaseKey,
} from './receiptEntitlement';

const purchase = (over: Record<string, unknown> = {}) => ({
  transactionId: 'txn-1',
  productId: 'quotemate_pro_yearly',
  purchaseToken: 'tok-1',
  ...over,
});

function mockFetch(status: number, body: unknown = {}) {
  (globalThis as any).fetch = vi.fn().mockResolvedValue({
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('id-token') };
});

describe('purchaseKey / claim guard', () => {
  it('prefers a stable identity and falls back sensibly', () => {
    expect(purchaseKey(purchase())).toBe('txn-1');
    expect(purchaseKey({ id: 'abc' })).toBe('abc');
    expect(purchaseKey({ purchaseToken: 'tok' })).toBe('tok');
    expect(purchaseKey({})).toBe('');
  });

  it('lets only one handler claim a transaction at a time', () => {
    expect(claimPurchase('k1')).toBe(true);
    expect(claimPurchase('k1')).toBe(false); // paywall vs launch sweep
    releasePurchase('k1');
    expect(claimPurchase('k1')).toBe(true);
    releasePurchase('k1');
  });

  it('never claims an empty key', () => {
    expect(claimPurchase('')).toBe(false);
  });
});

describe('validatePurchase', () => {
  it('returns granted on 200', async () => {
    mockFetch(200, { success: true });
    expect(await validatePurchase(purchase())).toBe('granted');
  });

  it('returns rejected on a terminal 402', async () => {
    mockFetch(402, { error: 'RECEIPT_VALIDATION_FAILED' });
    expect(await validatePurchase(purchase())).toBe('rejected');
  });

  it('returns retry on a 503', async () => {
    mockFetch(503, { error: 'RECEIPT_VALIDATION_UNAVAILABLE' });
    expect(await validatePurchase(purchase())).toBe('retry');
  });

  it('returns retry when the network throws, never rejected', async () => {
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await validatePurchase(purchase())).toBe('retry');
  });

  it('returns retry when signed out rather than posting anonymously', async () => {
    mockAuth.currentUser = null;
    const spy = vi.fn();
    (globalThis as any).fetch = spy;
    expect(await validatePurchase(purchase())).toBe('retry');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('recoverPendingPurchases', () => {
  it('entitles and finishes a verified purchase, and reports it', async () => {
    getRecoverablePurchases.mockResolvedValue([purchase()]);
    mockFetch(200, { success: true });
    const onGranted = vi.fn();

    const s = await recoverPendingPurchases({ onGranted });

    expect(s).toMatchObject({ checked: 1, granted: 1, rejected: 0, retry: 0 });
    expect(finishTransaction).toHaveBeenCalledTimes(1);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it('LEAVES a retryable purchase unfinished so the store re-delivers it', async () => {
    getRecoverablePurchases.mockResolvedValue([purchase()]);
    mockFetch(503, { error: 'RECEIPT_VALIDATION_UNAVAILABLE' });

    const s = await recoverPendingPurchases();

    expect(s).toMatchObject({ checked: 1, granted: 0, retry: 1 });
    expect(finishTransaction).not.toHaveBeenCalled(); // the whole point
  });

  it('finishes a rejected purchase so a dead receipt stops looping', async () => {
    getRecoverablePurchases.mockResolvedValue([purchase()]);
    mockFetch(402, { error: 'RECEIPT_VALIDATION_FAILED' });

    const s = await recoverPendingPurchases();

    expect(s).toMatchObject({ checked: 1, granted: 0, rejected: 1 });
    expect(finishTransaction).toHaveBeenCalledTimes(1);
  });

  it('does nothing when signed out', async () => {
    mockAuth.currentUser = null;
    const s = await recoverPendingPurchases();
    expect(s).toMatchObject({ checked: 0, granted: 0 });
    expect(getRecoverablePurchases).not.toHaveBeenCalled();
  });

  it('processes several outstanding purchases independently', async () => {
    getRecoverablePurchases.mockResolvedValue([
      purchase({ transactionId: 'a' }),
      purchase({ transactionId: 'b' }),
    ]);
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ status: 503, json: async () => ({}) });

    const s = await recoverPendingPurchases();

    expect(s).toMatchObject({ checked: 2, granted: 1, retry: 1 });
    expect(finishTransaction).toHaveBeenCalledTimes(1);
  });

  it('releases its claim so a later sweep can retry the same purchase', async () => {
    getRecoverablePurchases.mockResolvedValue([purchase()]);
    mockFetch(503);
    await recoverPendingPurchases();
    // If the claim leaked, this second sweep would skip and report checked: 0.
    const s = await recoverPendingPurchases();
    expect(s.checked).toBe(1);
  });

  it('survives a store that throws without crashing launch', async () => {
    getRecoverablePurchases.mockRejectedValue(new Error('store unavailable'));
    const s = await recoverPendingPurchases();
    expect(s).toMatchObject({ checked: 0, granted: 0 });
  });
});
