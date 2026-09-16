/**
 * A Square account that can't charge cards still mints checkout links; the
 * link just lands on "This business is currently not accepting payments".
 * These verdicts are what stops that link ever reaching a customer.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  READINESS_RECHECK_NOT_READY_MS,
  READINESS_RECHECK_READY_MS,
  assessSquareReadiness,
  probeSquareReadiness,
  shouldReprobeReadiness,
} from './squareReadiness';

const NOW = 1_790_000_000_000;
const activeMerchant = { status: 'ACTIVE', currency: 'AUD', country: 'AU', main_location_id: 'LMAIN' };
const cardLocation = { id: 'L1', status: 'ACTIVE', capabilities: ['CREDIT_CARD_PROCESSING', 'AUTOMATIC_TRANSFERS'], currency: 'AUD', country: 'AU' };

describe('assessSquareReadiness', () => {
  it('an activated Australian account is ready', () => {
    const v = assessSquareReadiness(activeMerchant, cardLocation, NOW);
    expect(v).toEqual({
      ready: true,
      reasons: [],
      checkedAt: NOW,
      currency: 'AUD',
      country: 'AU',
      capabilities: ['CREDIT_CARD_PROCESSING', 'AUTOMATIC_TRANSFERS'],
    });
  });

  it('the Slimjims shape — transfers only, no card processing — is not ready', () => {
    // Verbatim from Square on 16 Sep 2026 for the account behind the dead link.
    const v = assessSquareReadiness(
      { status: 'ACTIVE', currency: 'AUD', country: 'AU' },
      { id: 'L0CZ6KYK1KHTG', status: 'ACTIVE', capabilities: ['AUTOMATIC_TRANSFERS'], currency: 'AUD', country: 'AU' },
      NOW,
    );
    expect(v.ready).toBe(false);
    expect(v.reasons).toEqual(['no_card_processing']);
  });

  it('an inactive merchant or location is flagged even with card processing listed', () => {
    expect(assessSquareReadiness({ ...activeMerchant, status: 'INACTIVE' }, cardLocation, NOW).reasons)
      .toEqual(['merchant_inactive']);
    expect(assessSquareReadiness(activeMerchant, { ...cardLocation, status: 'INACTIVE' }, NOW).reasons)
      .toEqual(['location_inactive']);
  });

  it('a non-AUD account is flagged: every mint charges AUD', () => {
    const v = assessSquareReadiness(
      { status: 'ACTIVE', currency: 'USD', country: 'US' },
      { ...cardLocation, currency: 'USD', country: 'US' },
      NOW,
    );
    expect(v.reasons).toEqual(['currency_mismatch']);
    expect(v.currency).toBe('USD');
  });

  it('missing fields never flag — an older API shape must not switch Pay buttons off', () => {
    expect(assessSquareReadiness({ status: 'ACTIVE' }, { id: 'L1', status: 'ACTIVE' }, NOW).ready).toBe(true);
    expect(assessSquareReadiness(null, { id: 'L1' }, NOW).ready).toBe(true);
    expect(assessSquareReadiness({ status: 'ACTIVE' }, null, NOW).ready).toBe(true);
  });

  it('collects every reason at once', () => {
    const v = assessSquareReadiness(
      { status: 'INACTIVE', currency: 'NZD' },
      { status: 'INACTIVE', capabilities: [] },
      NOW,
    );
    expect(v.reasons).toEqual(['merchant_inactive', 'location_inactive', 'no_card_processing', 'currency_mismatch']);
  });
});

describe('shouldReprobeReadiness', () => {
  it('always probes a connection that has never been assessed', () => {
    expect(shouldReprobeReadiness(null, NOW)).toBe(true);
    expect(shouldReprobeReadiness(undefined, NOW)).toBe(true);
    expect(shouldReprobeReadiness({ ready: true, reasons: [] } as any, NOW)).toBe(true);
  });

  it('asks again about a flagged account every few minutes, so activation clears itself', () => {
    const flagged = { ready: false, reasons: ['no_card_processing' as const], checkedAt: NOW };
    expect(shouldReprobeReadiness(flagged, NOW + READINESS_RECHECK_NOT_READY_MS - 1)).toBe(false);
    expect(shouldReprobeReadiness(flagged, NOW + READINESS_RECHECK_NOT_READY_MS)).toBe(true);
  });

  it('re-confirms a healthy account daily, not on every mint', () => {
    const ok = { ready: true, reasons: [], checkedAt: NOW, capabilities: ['CREDIT_CARD_PROCESSING'] };
    expect(shouldReprobeReadiness(ok, NOW + READINESS_RECHECK_NOT_READY_MS)).toBe(false);
    expect(shouldReprobeReadiness(ok, NOW + READINESS_RECHECK_READY_MS)).toBe(true);
  });

  it('a "ready" verdict that never saw the location capabilities is a guess, re-checked on the short cadence', () => {
    // The locations call failed, so nothing flagged — but nothing was confirmed either.
    const guess = { ready: true, reasons: [], checkedAt: NOW };
    expect(shouldReprobeReadiness(guess, NOW + READINESS_RECHECK_NOT_READY_MS - 1)).toBe(false);
    expect(shouldReprobeReadiness(guess, NOW + READINESS_RECHECK_NOT_READY_MS)).toBe(true);
  });
});

describe('probeSquareReadiness', () => {
  const respond = (routes: Record<string, { ok: boolean; body?: any }>) =>
    vi.fn(async (url: string) => {
      const path = url.replace('https://sq.test', '');
      const r = routes[path];
      if (!r) throw new Error(`unexpected ${url}`);
      return { ok: r.ok, json: async () => r.body } as any;
    });

  it('fetches the merchant and the mint location and assesses them', async () => {
    const fetchFn = respond({
      '/v2/merchants/M1': { ok: true, body: { merchant: activeMerchant } },
      '/v2/locations/L1': { ok: true, body: { location: { ...cardLocation, capabilities: ['AUTOMATIC_TRANSFERS'] } } },
    });
    const v = await probeSquareReadiness({
      apiBase: 'https://sq.test', accessToken: 'tok', merchantId: 'M1', locationId: 'L1', fetchFn, now: NOW,
    });
    expect(v).toMatchObject({ ready: false, reasons: ['no_card_processing'], checkedAt: NOW });
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer tok' } });
  });

  it('falls back to the merchant main location when none is stored', async () => {
    const fetchFn = respond({
      '/v2/merchants/M1': { ok: true, body: { merchant: activeMerchant } },
      '/v2/locations/LMAIN': { ok: true, body: { location: cardLocation } },
    });
    const v = await probeSquareReadiness({ apiBase: 'https://sq.test', accessToken: 'tok', merchantId: 'M1', fetchFn, now: NOW });
    expect(v?.ready).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('returns null when Square answers nothing, so an outage keeps the last verdict', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const v = await probeSquareReadiness({ apiBase: 'https://sq.test', accessToken: 'tok', merchantId: 'M1', locationId: 'L1', fetchFn });
    expect(v).toBeNull();
  });

  it('an unauthorised token yields no verdict rather than a false flag', async () => {
    const fetchFn = respond({
      '/v2/merchants/M1': { ok: false },
      '/v2/locations/L1': { ok: false },
    });
    const v = await probeSquareReadiness({ apiBase: 'https://sq.test', accessToken: 'stale', merchantId: 'M1', locationId: 'L1', fetchFn });
    expect(v).toBeNull();
  });
});
