import { describe, it, expect, vi } from 'vitest';
import { fetchGooglePlaySubscription, fetchAppleSubscriptionStatus } from './iapStoreStatus';

const SA = JSON.stringify({ client_email: 'sa@x.iam', private_key: 'pk' });

function googleDeps(res: { status: number; body?: any }) {
  const fetchMock = vi.fn(async () => ({
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    json: async () => res.body,
    text: async () => JSON.stringify(res.body ?? ''),
  })) as unknown as typeof fetch;
  return {
    fetch: fetchMock,
    serviceAccountJson: SA,
    packageName: 'com.quotemate.app',
    getAccessToken: async () => 'token',
  };
}

describe('fetchGooglePlaySubscription', () => {
  const lookup = { productId: 'quotemate_premium_monthly', purchaseToken: 'tok', userId: 'u1' };

  it('a live sub → valid with Play\'s expiry and the billed price', async () => {
    const future = Date.now() + 20 * 86400e3;
    const r = await fetchGooglePlaySubscription(lookup, googleDeps({
      status: 200, body: { expiryTimeMillis: String(future), priceAmountMicros: '49000000', priceCurrencyCode: 'AUD' },
    }));
    expect(r.outcome).toBe('valid');
    expect(r.expiryDate?.getTime()).toBe(future);
    expect(r.priceMicros).toBe(49_000_000);
    expect(r.currency).toBe('AUD');
  });

  it('a lapsed sub → invalid (Play confirmed it)', async () => {
    const r = await fetchGooglePlaySubscription(lookup, googleDeps({ status: 200, body: { expiryTimeMillis: String(Date.now() - 1000) } }));
    expect(r.outcome).toBe('invalid');
  });

  it('401/403/5xx are our problem, not a verdict', async () => {
    for (const status of [401, 403, 500, 503]) {
      const r = await fetchGooglePlaySubscription(lookup, googleDeps({ status }));
      expect(r.outcome, `status ${status}`).toBe('unavailable');
    }
  });

  it('a 4xx about the token itself is a rejection', async () => {
    for (const status of [400, 404, 410]) {
      const r = await fetchGooglePlaySubscription(lookup, googleDeps({ status }));
      expect(r.outcome, `status ${status}`).toBe('invalid');
    }
  });

  it('no service account or token → unavailable, never invalid', async () => {
    expect((await fetchGooglePlaySubscription(lookup, { ...googleDeps({ status: 200 }), serviceAccountJson: undefined })).outcome).toBe('unavailable');
    expect((await fetchGooglePlaySubscription({ ...lookup, purchaseToken: '' }, googleDeps({ status: 200 }))).outcome).toBe('unavailable');
  });

  it('a thrown fetch → unavailable', async () => {
    const deps = { ...googleDeps({ status: 200 }), fetch: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch };
    expect((await fetchGooglePlaySubscription(lookup, deps)).outcome).toBe('unavailable');
  });

  it('hits purchases.subscriptions.get for the token', async () => {
    const deps = googleDeps({ status: 200, body: { expiryTimeMillis: String(Date.now() + 1000) } });
    await fetchGooglePlaySubscription(lookup, deps);
    const url = (deps.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/applications/com.quotemate.app/purchases/subscriptions/quotemate_premium_monthly/tokens/tok');
  });
});

describe('fetchAppleSubscriptionStatus', () => {
  const NOW = Date.parse('2026-09-06T14:30:00Z');
  const decodeTransaction = (async (jws: unknown) => ({
    outcome: 'valid' as const,
    expiryDate: new Date(Number(String(jws).replace('exp:', ''))),
    environment: 'Production', productId: 'quotemate_pro_monthly', transactionId: 't', price: null, currency: null,
    originalTransactionId: 'o', detail: 'verified',
  })) as any;
  const deps = (statuses: Array<{ status: number; exp?: number }> | Error) => ({
    now: () => NOW,
    decodeTransaction,
    makeClient: () => ({
      getAllSubscriptionStatuses: async () => {
        if (statuses instanceof Error) throw statuses;
        return { data: [{ lastTransactions: statuses.map((s) => ({ status: s.status, signedTransactionInfo: s.exp ? `exp:${s.exp}` : undefined })) }] };
      },
    }),
  });
  const lookup = { transactionId: '480003433052462', environment: 'Production', userId: 'u1' };

  it('REGRESSION: an ACTIVE sub whose renewal we never saw → valid with the renewed expiry', async () => {
    const renewedEnd = NOW + 27 * 86400e3;
    const r = await fetchAppleSubscriptionStatus(lookup, deps([{ status: 1, exp: renewedEnd }]));
    expect(r).toMatchObject({ outcome: 'valid', expiryDate: new Date(renewedEnd) });
  });

  it('billing grace period still counts as live', async () => {
    const r = await fetchAppleSubscriptionStatus(lookup, deps([{ status: 4, exp: NOW + 86400e3 }]));
    expect(r.outcome).toBe('valid');
  });

  it('expired / revoked / billing retry → invalid', async () => {
    for (const status of [2, 3, 5]) {
      const r = await fetchAppleSubscriptionStatus(lookup, deps([{ status, exp: NOW - 86400e3 }]));
      expect(r.outcome, `status ${status}`).toBe('invalid');
    }
  });

  it('any live sub in the group keeps the subscriber (monthly → yearly upgrade)', async () => {
    const r = await fetchAppleSubscriptionStatus(lookup, deps([{ status: 2, exp: NOW - 86400e3 }, { status: 1, exp: NOW + 300 * 86400e3 }]));
    expect(r.outcome).toBe('valid');
    expect(r.expiryDate?.getTime()).toBe(NOW + 300 * 86400e3);
  });

  it('active but the signed expiry is behind us → valid with no expiry (status wins)', async () => {
    const r = await fetchAppleSubscriptionStatus(lookup, deps([{ status: 1, exp: NOW - 1000 }]));
    expect(r).toMatchObject({ outcome: 'valid', expiryDate: null });
  });

  it('API errors are never a verdict', async () => {
    const err = Object.assign(new Error('unauthorized'), { httpStatusCode: 401 });
    expect((await fetchAppleSubscriptionStatus(lookup, deps(err))).outcome).toBe('unavailable');
    const notFound = Object.assign(new Error('nope'), { httpStatusCode: 404 });
    expect((await fetchAppleSubscriptionStatus(lookup, deps(notFound))).outcome).toBe('unavailable');
  });

  it('no ASC key configured → unavailable', async () => {
    const r = await fetchAppleSubscriptionStatus(lookup, { ...deps([]), makeClient: () => null });
    expect(r).toMatchObject({ outcome: 'unavailable', detail: 'no_asc_key' });
  });

  it('targets the sandbox client for a Sandbox doc', async () => {
    const makeClient = vi.fn(() => ({ getAllSubscriptionStatuses: async () => ({ data: [] }) }));
    await fetchAppleSubscriptionStatus({ ...lookup, environment: 'Sandbox' }, { ...deps([]), makeClient });
    expect(String(makeClient.mock.calls[0][0])).toBe('Sandbox');
  });
});
