/**
 * What a customer can pay right after accepting a quote.
 *
 * Only 3% of sent quotes ask for a deposit, so 97% of customers who accepted
 * never saw a way to pay. The offer helper now hands a deposit quote its
 * deposit link and every other quote an optional full-amount link — and both
 * acceptance paths (the email's GET confirmation page and the hosted page's
 * POST) render the same block from the same shape. The hosted page's POST
 * used to answer with no link at all, so even deposit quotes accepted there
 * never got a pay button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateConfirmationPage,
  paymentOfferForAcceptedQuote,
  respondToQuoteResponseBody,
  type AcceptedQuotePaymentDeps,
} from './index';

type Deps = AcceptedQuotePaymentDeps & {
  loadDocument: ReturnType<typeof vi.fn>;
  mint: ReturnType<typeof vi.fn>;
};

function deps(over: Partial<AcceptedQuotePaymentDeps> = {}): Deps {
  return {
    loadDocument: vi.fn(async () => null),
    mint: vi.fn(async () => ({ paymentLinkUrl: 'https://square.link/u/minted' })),
    ...over,
  } as Deps;
}

const depositQuote = { total: 4000, requireDeposit: true, depositPercentage: 25, depositAmount: 1000 };
const plainQuote = { total: 2029.64, requireDeposit: false };

// The surcharge-retirement gate treats every link minted before 1 Oct 2026
// as stale; reuse cases run the clock past that so the gate isn't what the
// test is measuring.
const AFTER_RETIREMENT = new Date('2026-10-05T10:00:00+11:00').getTime();

afterEach(() => {
  vi.useRealTimers();
});

describe('paymentOfferForAcceptedQuote', () => {
  it('deposit quote: offers the deposit through a deposit link', async () => {
    const d = deps();
    const offer = await paymentOfferForAcceptedQuote('u1', 'q1', depositQuote, d);
    expect(offer).toEqual({ kind: 'deposit', url: 'https://square.link/u/minted', amount: 1000 });
    expect(d.mint).toHaveBeenCalledWith('u1', 'q1', 'deposit');
  });

  it('deposit quote with no stored depositAmount derives it from the percentage', async () => {
    const offer = await paymentOfferForAcceptedQuote(
      'u1', 'q1', { total: 4000, requireDeposit: true, depositPercentage: 25 }, deps(),
    );
    expect(offer).toMatchObject({ kind: 'deposit', amount: 1000 });
  });

  it('plain quote with Square connected: offers the full amount through a quote_full link', async () => {
    const d = deps();
    const offer = await paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d);
    expect(offer).toEqual({ kind: 'full', url: 'https://square.link/u/minted', amount: 2029.64 });
    expect(d.mint).toHaveBeenCalledWith('u1', 'q1', 'quote_full');
  });

  it('plain quote with a deposit already paid offers only what is still owed', async () => {
    const offer = await paymentOfferForAcceptedQuote(
      'u1', 'q1', { total: 4000, depositPaid: 1000 }, deps(),
    );
    expect(offer).toMatchObject({ kind: 'full', amount: 3000 });
  });

  it('plain quote without Square connected: no offer, and acceptance still stands', async () => {
    // mintAndRotate returns null when getSquareTokens finds no connection.
    const d = deps({ mint: vi.fn(async () => null) });
    await expect(paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d)).resolves.toBeNull();
  });

  it('zero balance: nothing to pay, so it never mints', async () => {
    const d = deps();
    await expect(
      paymentOfferForAcceptedQuote('u1', 'q1', { total: 1000, depositPaid: 1000 }, d),
    ).resolves.toBeNull();
    await expect(paymentOfferForAcceptedQuote('u1', 'q1', { total: 0 }, d)).resolves.toBeNull();
    expect(d.mint).not.toHaveBeenCalled();
    expect(d.loadDocument).not.toHaveBeenCalled();
  });

  it('mint failure: a throw becomes null rather than failing the acceptance', async () => {
    const d = deps({ mint: vi.fn(async () => { throw new Error('Square 500'); }) });
    await expect(paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d)).resolves.toBeNull();
    const d2 = deps({ loadDocument: vi.fn(async () => { throw new Error('Firestore down'); }) });
    await expect(paymentOfferForAcceptedQuote('u1', 'q1', depositQuote, d2)).resolves.toBeNull();
  });

  it('reuses the document\'s fresh, unconsumed link of the same kind and amount instead of minting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_RETIREMENT);
    const d = deps({
      loadDocument: vi.fn(async () => ({
        activePaymentLink: {
          id: 'L1', url: 'https://square.link/u/live', kind: 'quote_full',
          amount: 2029.64, createdAt: AFTER_RETIREMENT - 60_000,
        },
      })),
    });
    const offer = await paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d);
    expect(offer).toEqual({ kind: 'full', url: 'https://square.link/u/live', amount: 2029.64 });
    expect(d.mint).not.toHaveBeenCalled();
  });

  it('mints afresh when the live link is consumed, stale, repriced, or the wrong kind', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_RETIREMENT);
    const base = { id: 'L1', url: 'https://square.link/u/live', kind: 'quote_full', amount: 2029.64, createdAt: AFTER_RETIREMENT - 60_000 };
    const variants = [
      { ...base, consumedAt: AFTER_RETIREMENT - 1000 },
      { ...base, createdAt: AFTER_RETIREMENT - 24 * 60 * 60 * 1000 },
      { ...base, amount: 1500 },
      { ...base, kind: 'deposit' },
    ];
    for (const activePaymentLink of variants) {
      const d = deps({ loadDocument: vi.fn(async () => ({ activePaymentLink })) });
      const offer = await paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d);
      expect(offer?.url).toBe('https://square.link/u/minted');
      expect(d.mint).toHaveBeenCalledWith('u1', 'q1', 'quote_full');
    }
  });

  it('never hands out a link minted before the card-surcharge retirement', async () => {
    // Today (Sep 2026) is before 1 Oct 2026: a same-day link is still
    // re-minted, exactly as the legacy minters and the rotator do.
    const d = deps({
      loadDocument: vi.fn(async () => ({
        activePaymentLink: {
          id: 'L1', url: 'https://square.link/u/old', kind: 'quote_full',
          amount: 2029.64, createdAt: Date.now() - 60_000,
        },
      })),
    });
    const offer = await paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d);
    expect(offer?.url).toBe('https://square.link/u/minted');
  });
});

describe('respondToQuoteResponseBody — what the hosted page reads', () => {
  const offer = { kind: 'full' as const, url: 'https://square.link/u/minted', amount: 2029.64 };

  it('carries the payment offer on an acceptance', () => {
    expect(respondToQuoteResponseBody('accepted', offer)).toEqual({
      success: true,
      message: 'Thank you! The quote has been accepted. The business will be in touch soon.',
      payment: { kind: 'full', url: 'https://square.link/u/minted', amount: 2029.64 },
    });
  });

  it('is an explicit null when there is nothing to pay', () => {
    expect(respondToQuoteResponseBody('accepted', null).payment).toBeNull();
  });

  it('never attaches a payment to a decline', () => {
    const body = respondToQuoteResponseBody('rejected', offer);
    expect(body.payment).toBeNull();
    expect(body.message).toContain('declined');
  });
});

describe('generateConfirmationPage — pay after accepting', () => {
  const deposit = { kind: 'deposit' as const, url: 'https://square.link/u/dep', amount: 1000 };
  const full = { kind: 'full' as const, url: 'https://square.link/u/full', amount: 2029.64 };

  it('deposit quote keeps its existing Pay deposit block', () => {
    const html = generateConfirmationPage('accepted', 'Thanks!', 'Hansen Fencing', null, null, deposit);
    expect(html).toContain('data-kind="deposit"');
    expect(html).toContain('Deposit to get started');
    expect(html).toContain('Pay deposit securely');
    expect(html).toContain('$1,000.00');
    expect(html).toContain('https://square.link/u/dep');
    expect(html).toContain('Hansen Fencing is notified the moment it clears');
    expect(html).not.toContain('Pay now if you like');
  });

  it('plain quote gets an optional Pay now block for the amount owed', () => {
    const html = generateConfirmationPage('accepted', 'Thanks!', 'Hansen Fencing', null, null, full);
    expect(html).toContain('data-kind="full"');
    expect(html).toContain('Pay now if you like');
    expect(html).toContain('$2,029.64');
    expect(html).toContain('>Pay by card</a>');
    expect(html).toContain('href="https://square.link/u/full"');
    expect(html).toContain('Secure card payment through Square. Or Hansen Fencing will invoice you when the job');
    // Optional means the ordinary next step still stands.
    expect(html).toContain('Hansen Fencing will be in touch to lock in a date');
    expect(html).not.toContain('Deposit to get started');
    expect(html).not.toContain('Pay deposit securely');
  });

  it('keeps the footer line and never says the forbidden word', () => {
    for (const payment of [deposit, full, null]) {
      const html = generateConfirmationPage('accepted', 'Thanks!', 'Hansen Fencing', null, null, payment);
      expect(html).toContain('Sent with QuoteMate');
      expect(html).not.toMatch(/\bAI\b/);
    }
  });

  it('renders no pay block with no offer, and never on a decline', () => {
    expect(generateConfirmationPage('accepted', 'Thanks!', 'Hansen Fencing', null, null, null))
      .not.toContain('class="deposit"');
    const declined = generateConfirmationPage('declined', 'Recorded.', 'Hansen Fencing', null, null, full);
    expect(declined).not.toContain('https://square.link/u/full');
    expect(declined).not.toContain('Pay now if you like');
  });
});
