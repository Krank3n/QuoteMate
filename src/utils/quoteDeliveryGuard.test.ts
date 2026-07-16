import { beforeEach, describe, expect, it, vi } from 'vitest';

const square = vi.hoisted(() => ({
  checkSquareConnection: vi.fn(),
  mintInvoicePaymentLink: vi.fn(),
  mintQuoteDepositPaymentLink: vi.fn(),
  mintQuoteFullPaymentLink: vi.fn(),
}));
vi.mock('../services/squareService', () => square);

const planState = vi.hoisted(() => ({ plan: 'trial' as 'trial' | 'free' | 'pro' }));
vi.mock('../store/useStore', () => ({
  useStore: { getState: () => ({ getEffectivePlan: () => planState.plan }) },
}));

import {
  attachTrialPayLink,
  ensureCanDeliver,
  shouldOfferTrialPayLink,
} from './quoteDeliveryGuard';

const quote = (over: Record<string, unknown> = {}) =>
  ({ kind: 'quote', doc: { id: 'q1', ...over } }) as any;
const invoice = (over: Record<string, unknown> = {}) =>
  ({ kind: 'invoice', doc: { id: 'i1', ...over } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  planState.plan = 'trial';
  square.checkSquareConnection.mockResolvedValue({ connected: true });
  square.mintQuoteFullPaymentLink.mockResolvedValue({ paymentLinkUrl: 'https://sq/full' });
  square.mintQuoteDepositPaymentLink.mockResolvedValue({ paymentLinkUrl: 'https://sq/deposit' });
  square.mintInvoicePaymentLink.mockResolvedValue({ paymentLinkUrl: 'https://sq/invoice' });
});

describe('shouldOfferTrialPayLink', () => {
  it('offers only to trial users whose doc has no link yet', () => {
    expect(shouldOfferTrialPayLink('trial', {})).toBe(true);
    expect(shouldOfferTrialPayLink('trial', { squarePaymentLinkUrl: 'https://sq/x' })).toBe(false);
    // Free users hit the mandatory gate; Pro users aren't pitched here.
    expect(shouldOfferTrialPayLink('free', {})).toBe(false);
    expect(shouldOfferTrialPayLink('pro', {})).toBe(false);
  });
});

describe('attachTrialPayLink', () => {
  it('routes to connect when Square is not connected (and never mints)', async () => {
    square.checkSquareConnection.mockResolvedValue({ connected: false });
    expect(await attachTrialPayLink(quote())).toEqual({ status: 'connect_required' });
    expect(square.mintQuoteFullPaymentLink).not.toHaveBeenCalled();
  });

  it('treats a connection-check failure as connect_required, not an error', async () => {
    square.checkSquareConnection.mockRejectedValue(new Error('offline'));
    expect(await attachTrialPayLink(quote())).toEqual({ status: 'connect_required' });
  });

  it('mints a full-total link for a plain quote', async () => {
    expect(await attachTrialPayLink(quote())).toEqual({
      status: 'attached',
      squarePaymentLinkUrl: 'https://sq/full',
    });
    expect(square.mintQuoteFullPaymentLink).toHaveBeenCalledWith('q1');
  });

  it('mints a deposit link when the quote requires a deposit', async () => {
    const result = await attachTrialPayLink(quote({ requireDeposit: true, depositPercentage: 20 }));
    expect(result).toEqual({ status: 'attached', squarePaymentLinkUrl: 'https://sq/deposit' });
    expect(square.mintQuoteDepositPaymentLink).toHaveBeenCalledWith('q1');
    expect(square.mintQuoteFullPaymentLink).not.toHaveBeenCalled();
  });

  it('requireDeposit without a percentage falls back to the full link', async () => {
    await attachTrialPayLink(quote({ requireDeposit: true, depositPercentage: 0 }));
    expect(square.mintQuoteFullPaymentLink).toHaveBeenCalledWith('q1');
  });

  it('mints an invoice link for invoices', async () => {
    const result = await attachTrialPayLink(invoice());
    expect(result).toEqual({ status: 'attached', squarePaymentLinkUrl: 'https://sq/invoice' });
    expect(square.mintInvoicePaymentLink).toHaveBeenCalledWith('i1');
  });

  it('reuses an existing link without re-minting', async () => {
    const result = await attachTrialPayLink(quote({ squarePaymentLinkUrl: 'https://sq/existing' }));
    expect(result).toEqual({ status: 'attached', squarePaymentLinkUrl: 'https://sq/existing' });
    expect(square.mintQuoteFullPaymentLink).not.toHaveBeenCalled();
  });

  it('surfaces mint failures as failed with the message', async () => {
    square.mintQuoteFullPaymentLink.mockRejectedValue(new Error('Square 500'));
    expect(await attachTrialPayLink(quote())).toEqual({ status: 'failed', message: 'Square 500' });
  });
});

describe('ensureCanDeliver (regression — the mandatory free-tier gate)', () => {
  it('trial and pro pass without a connection round-trip', async () => {
    for (const plan of ['trial', 'pro'] as const) {
      planState.plan = plan;
      expect((await ensureCanDeliver(quote())).ok).toBe(true);
    }
    expect(square.checkSquareConnection).not.toHaveBeenCalled();
  });

  it('free users still require a connection', async () => {
    planState.plan = 'free';
    square.checkSquareConnection.mockResolvedValue({ connected: false });
    const gate = await ensureCanDeliver(quote());
    expect(gate).toMatchObject({ ok: false, reason: 'connect_square' });
  });

  it('free + connected mints through the shared routing (deposit rule intact)', async () => {
    planState.plan = 'free';
    const gate = await ensureCanDeliver(quote({ requireDeposit: true, depositPercentage: 50 }));
    expect(gate).toEqual({ ok: true, squarePaymentLinkUrl: 'https://sq/deposit' });
    expect(square.mintQuoteDepositPaymentLink).toHaveBeenCalledWith('q1');
  });
});
