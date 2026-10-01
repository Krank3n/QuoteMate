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
  ACCEPTANCE_MINT_TIMEOUT_MS,
  isSafePaymentLinkUrl,
  generateConfirmationPage,
  depositDueWithoutCardOffer,
  paymentOfferForAcceptedQuote,
  respondToQuoteResponseBody,
  type AcceptedQuotePaymentDeps,
} from './index';
import { SURCHARGE_RETIRED_AT_MS } from './squarePricing.helpers';

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
  it('a mint that never answers gives way to the plain thank-you instead of holding the acceptance', async () => {
    vi.useFakeTimers();
    const d = deps({ mint: vi.fn(() => new Promise(() => {})) });
    const pending = paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d);
    await vi.advanceTimersByTimeAsync(ACCEPTANCE_MINT_TIMEOUT_MS + 1);
    expect(await pending).toBeNull();
  });

  it('never hands the page a link that is not a plain https URL', async () => {
    for (const url of ['javascript:alert(1)', 'https://x/" onfocus=alert(1) autofocus x="', 'http://square.link/u/x']) {
      const d = deps({ mint: vi.fn(async () => ({ paymentLinkUrl: url })) });
      expect(await paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d)).toBeNull();
    }
    expect(isSafePaymentLinkUrl('https://square.link/u/abc?x=1&y=2')).toBe(true);
  });

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
    // Pinned either side of the cutoff rather than read off the real clock:
    // the clock version passed only while "today" was before 1 Oct 2026, and
    // started failing the day the retirement took effect. The link is two
    // minutes old — fresh, unconsumed, right amount and kind — so the
    // retirement gate is the only reason left to re-mint it.
    vi.useFakeTimers();
    vi.setSystemTime(SURCHARGE_RETIRED_AT_MS + 60_000);
    const d = deps({
      loadDocument: vi.fn(async () => ({
        activePaymentLink: {
          id: 'L1', url: 'https://square.link/u/old', kind: 'quote_full',
          amount: 2029.64, createdAt: SURCHARGE_RETIRED_AT_MS - 60_000,
        },
      })),
    });
    const offer = await paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d);
    expect(offer?.url).toBe('https://square.link/u/minted');
    expect(d.mint).toHaveBeenCalledWith('u1', 'q1', 'quote_full');
  });

  it('reuses the same link minted just after the retirement', async () => {
    // The control for the case above: identical age and shape, one side of
    // the cutoff later — reused, so the cutoff is what decided it.
    vi.useFakeTimers();
    vi.setSystemTime(SURCHARGE_RETIRED_AT_MS + 3 * 60_000);
    const d = deps({
      loadDocument: vi.fn(async () => ({
        activePaymentLink: {
          id: 'L1', url: 'https://square.link/u/new', kind: 'quote_full',
          amount: 2029.64, createdAt: SURCHARGE_RETIRED_AT_MS + 60_000,
        },
      })),
    });
    const offer = await paymentOfferForAcceptedQuote('u1', 'q1', plainQuote, d);
    expect(offer?.url).toBe('https://square.link/u/new');
    expect(d.mint).not.toHaveBeenCalled();
  });
});

describe('respondToQuoteResponseBody — what the hosted page reads', () => {
  const offer = { kind: 'full' as const, url: 'https://square.link/u/minted', amount: 2029.64 };

  it('carries the payment offer on an acceptance', () => {
    expect(respondToQuoteResponseBody('accepted', offer)).toEqual({
      success: true,
      message: 'Thank you! The quote has been accepted. The business will be in touch soon.',
      payment: { kind: 'full', url: 'https://square.link/u/minted', amount: 2029.64 },
      depositDue: null,
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

// Once a deposit has been recorded against the quote (paid by bank transfer,
// or an earlier card payment), the customer is never handed a deposit link
// for it again — the deposit minter charges the whole depositAmount.
describe('paymentOfferForAcceptedQuote — deposit already recorded', () => {
  it('a recorded deposit means no deposit link; what is still owed is offered as optional Pay now', async () => {
    const d = deps();
    const offer = await paymentOfferForAcceptedQuote(
      'u1', 'q1', { ...depositQuote, depositPaid: 1000 }, d,
    );
    expect(d.mint).not.toHaveBeenCalledWith('u1', 'q1', 'deposit');
    expect(offer).toEqual({ kind: 'full', url: 'https://square.link/u/minted', amount: 3000 });
  });

  it('part of the deposit recorded: still no deposit link', async () => {
    const d = deps();
    const offer = await paymentOfferForAcceptedQuote('u1', 'q1', { ...depositQuote, depositPaid: 250 }, d);
    expect(offer?.kind).toBe('full');
    expect(d.mint).not.toHaveBeenCalledWith('u1', 'q1', 'deposit');
  });

  it('nothing recorded: the deposit link as before', async () => {
    const offer = await paymentOfferForAcceptedQuote('u1', 'q1', { ...depositQuote, depositPaid: 0 }, deps());
    expect(offer?.kind).toBe('deposit');
  });
});

describe('depositDueWithoutCardOffer — a deposit by bank transfer', () => {
  const transferQuote = { total: 960, requireDeposit: true, depositPercentage: 31.25, depositAmount: 300 };

  it('no card offer: the deposit the quote asks for', () => {
    expect(depositDueWithoutCardOffer(transferQuote, null)).toBe(300);
  });

  it('derives the amount from the percentage when none is stored', () => {
    expect(depositDueWithoutCardOffer({ total: 1000, requireDeposit: true, depositPercentage: 30 }, null)).toBe(300);
  });

  it('null with any card offer — the page never asks two ways', () => {
    expect(depositDueWithoutCardOffer(transferQuote, { kind: 'deposit', url: 'https://square.link/u/d', amount: 300 })).toBeNull();
    expect(depositDueWithoutCardOffer(transferQuote, { kind: 'full', url: 'https://square.link/u/f', amount: 960 })).toBeNull();
  });

  it('null when no deposit is asked for, or one is already recorded', () => {
    expect(depositDueWithoutCardOffer({ total: 960, requireDeposit: false, depositAmount: 300 }, null)).toBeNull();
    expect(depositDueWithoutCardOffer({ ...transferQuote, depositPaid: 300 }, null)).toBeNull();
  });

  it('rides on the hosted page response only for an acceptance', () => {
    expect(respondToQuoteResponseBody('accepted', null, 300).depositDue).toBe(300);
    expect(respondToQuoteResponseBody('rejected', null, 300).depositDue).toBeNull();
  });
});

describe('generateConfirmationPage — deposit by bank transfer', () => {
  it('names the deposit and points at the payment details on the quote', () => {
    const html = generateConfirmationPage('accepted', 'Thanks!', 'Coastal Concreting', null, null, null, 300);
    expect(html).toContain('data-kind="transfer"');
    expect(html).toContain('Deposit to get started');
    expect(html).toContain('$300.00');
    expect(html).toContain('Payment details are on your quote.');
    expect(html).not.toContain('will be in touch to lock in a date');
    expect(html).not.toContain('Pay deposit securely');
  });

  it('never beside a card offer, and never on a decline', () => {
    const full = { kind: 'full' as const, url: 'https://square.link/u/full', amount: 960 };
    expect(generateConfirmationPage('accepted', 'Thanks!', 'Coastal Concreting', null, null, full, 300))
      .not.toContain('data-kind="transfer"');
    expect(generateConfirmationPage('declined', 'Recorded.', 'Coastal Concreting', null, null, null, 300))
      .not.toContain('data-kind="transfer"');
  });
});
