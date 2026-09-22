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
  PAY_LINK_CHECK_TIMEOUT_MS,
  attachPayLink,
  carriesPayableAmount,
  ensureCanDeliver,
  isConnectSquareRefusal,
} from './quoteDeliveryGuard';

const quote = (over: Record<string, unknown> = {}) =>
  ({ kind: 'quote', doc: { id: 'q1', ...over } }) as any;
const depositQuote = (over: Record<string, unknown> = {}) =>
  quote({ requireDeposit: true, depositPercentage: 20, ...over });
const invoice = (over: Record<string, unknown> = {}) =>
  ({ kind: 'invoice', doc: { id: 'i1', ...over } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  planState.plan = 'trial';
  square.checkSquareConnection.mockResolvedValue({ connected: true });
  square.mintQuoteDepositPaymentLink.mockResolvedValue({ paymentLinkUrl: 'https://sq/deposit' });
  square.mintInvoicePaymentLink.mockResolvedValue({ paymentLinkUrl: 'https://sq/invoice' });
});

describe('carriesPayableAmount', () => {
  it('is true for every invoice', () => {
    expect(carriesPayableAmount(invoice())).toBe(true);
  });

  it('is true for a quote that asks for a deposit', () => {
    expect(carriesPayableAmount(depositQuote())).toBe(true);
  });

  it('is false for a plain quote — accepted, not paid', () => {
    expect(carriesPayableAmount(quote())).toBe(false);
    expect(carriesPayableAmount(quote({ requireDeposit: false, depositPercentage: 20 }))).toBe(false);
  });

  it('requireDeposit without a percentage collects nothing', () => {
    expect(carriesPayableAmount(quote({ requireDeposit: true, depositPercentage: 0 }))).toBe(false);
    expect(carriesPayableAmount(quote({ requireDeposit: true }))).toBe(false);
  });
});

describe('isConnectSquareRefusal — recognising the server gate', () => {
  it('is the 402 with the connect_square reason, nothing else', () => {
    expect(isConnectSquareRefusal(402, { error: 'Connect Square…', reason: 'connect_square' })).toBe(true);
    expect(isConnectSquareRefusal(402, { error: 'Connect Square…' })).toBe(false);
    expect(isConnectSquareRefusal(500, { reason: 'connect_square' })).toBe(false);
    expect(isConnectSquareRefusal(402, null)).toBe(false);
    expect(isConnectSquareRefusal(402, 'connect_square')).toBe(false);
  });
});

describe('ensureCanDeliver — the free-tier gate', () => {
  it('trial and pro pass without a connection round-trip, invoices included', async () => {
    for (const plan of ['trial', 'pro'] as const) {
      planState.plan = plan;
      expect((await ensureCanDeliver(quote())).ok).toBe(true);
      expect((await ensureCanDeliver(invoice())).ok).toBe(true);
    }
    expect(square.checkSquareConnection).not.toHaveBeenCalled();
  });

  it('trial and pro never get a stored link handed back unchecked — attachPayLink decides', async () => {
    planState.plan = 'pro';
    expect(await ensureCanDeliver(invoice({ squarePaymentLinkUrl: 'https://sq/stale' }))).toEqual({ ok: true });
  });

  it('a free user whose Square account cannot take card payments gets told, and nothing is minted', async () => {
    planState.plan = 'free';
    square.checkSquareConnection.mockResolvedValue({
      connected: true,
      merchantName: 'Slimjims',
      paymentReadiness: { ready: false, reasons: ['no_card_processing'], checkedAt: 1 },
    });
    const gate = await ensureCanDeliver(invoice({ squarePaymentLinkUrl: 'https://sq/dead' }));
    expect(gate.ok).toBe(false);
    expect(gate).toMatchObject({ reason: 'mint_link_failed' });
    expect((gate as any).message).toContain('Slimjims');
    expect(square.mintInvoicePaymentLink).not.toHaveBeenCalled();
  });

  // Regression: 8 of the 13 tradies who met this gate on a quote abandoned
  // the send. A quote without a deposit has nothing for Square to collect,
  // so a free user sends it like anyone else.
  it('lets a free user send a plain quote without Square, and without asking', async () => {
    planState.plan = 'free';
    square.checkSquareConnection.mockResolvedValue({ connected: false });

    expect(await ensureCanDeliver(quote())).toEqual({ ok: true, squarePaymentLinkUrl: undefined });
    expect(square.checkSquareConnection).not.toHaveBeenCalled();
    expect(square.mintQuoteDepositPaymentLink).not.toHaveBeenCalled();
  });

  it('free users still need Square for an invoice', async () => {
    planState.plan = 'free';
    square.checkSquareConnection.mockResolvedValue({ connected: false });
    expect(await ensureCanDeliver(invoice())).toMatchObject({ ok: false, reason: 'connect_square' });
  });

  it('free users still need Square for a deposit quote', async () => {
    planState.plan = 'free';
    square.checkSquareConnection.mockResolvedValue({ connected: false });
    expect(await ensureCanDeliver(depositQuote())).toMatchObject({ ok: false, reason: 'connect_square' });
  });

  it('treats a failed connection check as not connected', async () => {
    planState.plan = 'free';
    square.checkSquareConnection.mockRejectedValue(new Error('offline'));
    expect(await ensureCanDeliver(invoice())).toMatchObject({ ok: false, reason: 'connect_square' });
  });

  it('free + connected mints the invoice link', async () => {
    planState.plan = 'free';
    expect(await ensureCanDeliver(invoice())).toEqual({ ok: true, squarePaymentLinkUrl: 'https://sq/invoice' });
    expect(square.mintInvoicePaymentLink).toHaveBeenCalledWith('i1');
  });

  it('free + connected mints the deposit link for a deposit quote', async () => {
    planState.plan = 'free';
    expect(await ensureCanDeliver(depositQuote({ depositPercentage: 50 }))).toEqual({
      ok: true,
      squarePaymentLinkUrl: 'https://sq/deposit',
    });
    expect(square.mintQuoteDepositPaymentLink).toHaveBeenCalledWith('q1');
  });

  it('reuses a link the doc already carries without re-minting', async () => {
    planState.plan = 'free';
    expect(await ensureCanDeliver(invoice({ squarePaymentLinkUrl: 'https://sq/existing' }))).toEqual({
      ok: true,
      squarePaymentLinkUrl: 'https://sq/existing',
    });
    expect(square.mintInvoicePaymentLink).not.toHaveBeenCalled();
  });

  it('a mint failure on the free tier is a typed, retryable gate', async () => {
    planState.plan = 'free';
    square.mintInvoicePaymentLink.mockRejectedValue(new Error('Square 500'));
    expect(await ensureCanDeliver(invoice())).toEqual({
      ok: false,
      reason: 'mint_link_failed',
      message: 'Square 500',
    });
  });
});

describe('attachPayLink — the link for copy composed on the phone', () => {
  it('mints an invoice link on any plan when Square is connected', async () => {
    for (const plan of ['trial', 'pro', 'free'] as const) {
      planState.plan = plan;
      expect(await attachPayLink(invoice())).toBe('https://sq/invoice');
    }
    expect(square.mintInvoicePaymentLink).toHaveBeenCalledTimes(3);
  });

  it('mints the deposit link for a deposit quote', async () => {
    expect(await attachPayLink(depositQuote())).toBe('https://sq/deposit');
    expect(square.mintQuoteDepositPaymentLink).toHaveBeenCalledWith('q1');
    expect(square.mintInvoicePaymentLink).not.toHaveBeenCalled();
  });

  it('reuses the link the doc already carries once the connection is confirmed, without re-minting', async () => {
    expect(await attachPayLink(invoice({ squarePaymentLinkUrl: 'https://sq/existing' }))).toBe('https://sq/existing');
    expect(square.checkSquareConnection).toHaveBeenCalledTimes(1);
    expect(square.mintInvoicePaymentLink).not.toHaveBeenCalled();
  });

  // Regression, 16 Sep 2026: a stored link outlived the connection it was
  // minted under and went out on a PDF to a dead Square checkout page.
  it('drops a stored link when Square is no longer connected', async () => {
    square.checkSquareConnection.mockResolvedValue({ connected: false });
    expect(await attachPayLink(invoice({ squarePaymentLinkUrl: 'https://sq/stale' }))).toBeUndefined();
    expect(square.mintInvoicePaymentLink).not.toHaveBeenCalled();
  });

  it('keeps the stored link when the connection check throws — bad signal must not strip a good link', async () => {
    square.checkSquareConnection.mockRejectedValue(new Error('Network request failed'));
    expect(await attachPayLink(invoice({ squarePaymentLinkUrl: 'https://sq/existing' }))).toBe('https://sq/existing');
    expect(square.mintInvoicePaymentLink).not.toHaveBeenCalled();
  });

  it('keeps the stored link when the connection check times out', async () => {
    vi.useFakeTimers();
    try {
      square.checkSquareConnection.mockReturnValue(new Promise(() => {}));
      const pending = attachPayLink(invoice({ squarePaymentLinkUrl: 'https://sq/existing' }));
      await vi.advanceTimersByTimeAsync(PAY_LINK_CHECK_TIMEOUT_MS + 1);
      expect(await pending).toBe('https://sq/existing');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a doc with no stored link comes back empty when the check cannot complete', async () => {
    square.checkSquareConnection.mockRejectedValue(new Error('offline'));
    expect(await attachPayLink(invoice())).toBeUndefined();
    expect(square.mintInvoicePaymentLink).not.toHaveBeenCalled();
  });

  it('drops a stored link, and mints nothing, when Square says the account cannot take card payments', async () => {
    square.checkSquareConnection.mockResolvedValue({
      connected: true,
      paymentReadiness: { ready: false, reasons: ['no_card_processing'], checkedAt: 1 },
    });
    expect(await attachPayLink(invoice({ squarePaymentLinkUrl: 'https://sq/dead' }))).toBeUndefined();
    expect(await attachPayLink(invoice())).toBeUndefined();
    expect(square.mintInvoicePaymentLink).not.toHaveBeenCalled();
  });

  it('costs a plain quote nothing — no link, no round-trip', async () => {
    expect(await attachPayLink(quote())).toBeUndefined();
    expect(square.checkSquareConnection).not.toHaveBeenCalled();
    expect(square.mintQuoteDepositPaymentLink).not.toHaveBeenCalled();
    expect(square.mintQuoteFullPaymentLink).not.toHaveBeenCalled();
  });

  it('comes back empty when Square is not connected, and never mints', async () => {
    square.checkSquareConnection.mockResolvedValue({ connected: false });
    expect(await attachPayLink(invoice())).toBeUndefined();
    expect(square.mintInvoicePaymentLink).not.toHaveBeenCalled();
  });

  // The send must go ahead without a link sooner than not at all.
  it('never blocks a send on a Square hiccup', async () => {
    square.checkSquareConnection.mockRejectedValue(new Error('offline'));
    expect(await attachPayLink(invoice())).toBeUndefined();

    square.checkSquareConnection.mockResolvedValue({ connected: true });
    square.mintInvoicePaymentLink.mockRejectedValue(new Error('Square 500'));
    expect(await attachPayLink(invoice())).toBeUndefined();
  });
});
