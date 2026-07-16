import { describe, expect, it } from 'vitest';
import {
  EventFunnelUserInput,
  docHasSquarePayment,
  foldEvent,
  furthestStage,
  isMonetized,
  rollupEventFunnel,
} from './eventFunnel.helpers';

const NOW = Date.parse('2026-07-16T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

// Matches the real subscription doc shapes (see subscription.helpers.ts):
// billed store/Stripe subs carry a product/subscription id; the client trial
// writer stores trialStartedAt as an ISO string with isPro:false.
const billedSub = { isPro: true, platform: 'ios', productId: 'quotemate_pro_yearly' };
const bareProSub = { isPro: true }; // manual flag — never billed
const compSub = { isPro: true, platform: 'admin_grant', productId: 'comp' };
const trialSub = { isPro: false, trialStartedAt: new Date(NOW - 3 * DAY).toISOString() };

function user(over: Partial<EventFunnelUserInput> = {}): EventFunnelUserInput {
  return {
    uid: 'u1',
    sub: null,
    hasQuoteDraft: false,
    hasSentDoc: false,
    hasSquareConnection: false,
    hasSquarePayment: false,
    viewedPaywall: false,
    startedCheckout: false,
    ...over,
  };
}

describe('isMonetized', () => {
  it('true for a billed Pro sub', () => {
    expect(isMonetized(user({ sub: billedSub }))).toBe(true);
  });

  it('true for a Square-collecting free user', () => {
    expect(isMonetized(user({ hasSquarePayment: true }))).toBe(true);
  });

  it('false for bare isPro flags and admin_grant comps (look Pro, pay nothing)', () => {
    expect(isMonetized(user({ sub: bareProSub }))).toBe(false);
    expect(isMonetized(user({ sub: compSub }))).toBe(false);
  });

  it('false for a plain trial user', () => {
    expect(isMonetized(user({ sub: trialSub }))).toBe(false);
  });
});

describe('furthestStage', () => {
  it('classifies the shared stages cumulatively', () => {
    expect(furthestStage(user()).shared).toBe('signup');
    expect(furthestStage(user({ hasQuoteDraft: true })).shared).toBe('quote_draft');
    // hasSentDoc wins even if the draft flag was missed.
    expect(furthestStage(user({ hasSentDoc: true })).shared).toBe('quote_sent');
  });

  it('never regresses below durable evidence on Path A', () => {
    // Billed sub with zero recorded events (pre-instrumentation subscriber).
    const stages = furthestStage(user({ sub: billedSub }));
    expect(stages.pathA).toBe('pro_paid');
  });

  it('orders Path A event stages and ignores non-entrants', () => {
    expect(furthestStage(user()).pathA).toBeNull();
    expect(furthestStage(user({ viewedPaywall: true })).pathA).toBe('paywall_viewed');
    expect(furthestStage(user({ viewedPaywall: true, startedCheckout: true })).pathA).toBe(
      'checkout_started'
    );
  });

  it('a bare isPro flag does not count as pro_paid', () => {
    expect(furthestStage(user({ sub: bareProSub })).pathA).toBeNull();
  });

  it('Path B: payment beats connection, even if the connection doc is gone', () => {
    expect(furthestStage(user()).pathB).toBeNull();
    expect(furthestStage(user({ hasSquareConnection: true })).pathB).toBe('square_connected');
    expect(furthestStage(user({ hasSquarePayment: true })).pathB).toBe('first_payment_collected');
  });
});

describe('rollupEventFunnel', () => {
  it('produces cumulative reach, per-path drop-off and the headline rate', () => {
    const inputs = [
      // Trial user who stalled at the paywall.
      user({ uid: 'a', sub: trialSub, hasQuoteDraft: true, hasSentDoc: true, viewedPaywall: true }),
      // Trial user who checked out and paid (billed).
      user({
        uid: 'b',
        sub: { ...billedSub, trialStartedAt: trialSub.trialStartedAt },
        hasSentDoc: true,
        viewedPaywall: true,
        startedCheckout: true,
      }),
      // Free trial user collecting via Square — monetised path B.
      user({ uid: 'c', sub: trialSub, hasSentDoc: true, hasSquareConnection: true, hasSquarePayment: true }),
      // Connected Square but never collected — the stall the admin view exists for.
      user({ uid: 'd', sub: trialSub, hasQuoteDraft: true, hasSquareConnection: true }),
      // Fresh signup, nothing yet, no trial.
      user({ uid: 'e' }),
    ];

    const payload = rollupEventFunnel(inputs, NOW, 30);

    expect(payload.shared).toEqual({ signups: 5, quoteDraft: 4, quoteSent: 3 });
    expect(payload.pathA.paywallViewed).toBe(2);
    expect(payload.pathA.checkoutStarted).toBe(1);
    expect(payload.pathA.proPaid).toBe(1);
    expect(payload.pathA.pctCheckoutStarted).toBe(0.5);
    expect(payload.pathA.pctProPaid).toBe(1);
    expect(payload.pathB).toEqual({
      squareConnected: 2,
      firstPaymentCollected: 1,
      pctFirstPayment: 0.5,
    });
    expect(payload.monetized).toEqual({ count: 2, viaPro: 1, viaSquare: 1, viaBoth: 0 });
    expect(payload.trialStarted).toBe(4);
    expect(payload.conversion.trialToMonetized).toBe(0.5);
    expect(payload.conversion.activationRate).toBe(3 / 5);
    // Stall histogram: d is the "connected, never collected" row.
    expect(payload.histogram.pathB.square_connected).toBe(1);
    expect(payload.histogram.pathB.first_payment_collected).toBe(1);
    expect(payload.histogram.pathA.paywall_viewed).toBe(1);
    expect(payload.histogram.shared.signup).toBe(1);
  });

  it('a user monetised on both paths counts once in the headline', () => {
    const both = user({
      uid: 'x',
      sub: { ...billedSub, trialStartedAt: trialSub.trialStartedAt },
      hasSentDoc: true,
      hasSquarePayment: true,
    });
    const payload = rollupEventFunnel([both], NOW, 30);
    expect(payload.monetized).toEqual({ count: 1, viaPro: 1, viaSquare: 1, viaBoth: 1 });
    expect(payload.conversion.trialToMonetized).toBe(1);
  });

  it('zero denominators produce 0, never NaN', () => {
    const payload = rollupEventFunnel([], NOW, 30);
    expect(payload.conversion.trialToMonetized).toBe(0);
    expect(payload.conversion.activationRate).toBe(0);
    expect(payload.pathA.pctCheckoutStarted).toBe(0);
    expect(payload.pathB.pctFirstPayment).toBe(0);
  });
});

describe('foldEvent', () => {
  it('sets flags for the funnel events and de-dups repeats', () => {
    let flags = foldEvent(undefined, 'paywall_viewed');
    flags = foldEvent(flags, 'paywall_viewed');
    flags = foldEvent(flags, 'checkout_started');
    expect(flags).toEqual({ viewedPaywall: true, startedCheckout: true });
  });

  it('ignores unrelated events without creating noise', () => {
    const flags = foldEvent(undefined, 'quote_started');
    expect(flags).toEqual({ viewedPaywall: false, startedCheckout: false });
  });
});

describe('docHasSquarePayment', () => {
  it('true only for webhook-written square payments', () => {
    expect(docHasSquarePayment({ payments: [{ method: 'square', amount: 100 }] })).toBe(true);
    expect(docHasSquarePayment({ payments: [{ squarePaymentId: 'sq-1', amount: 50 }] })).toBe(true);
  });

  it('false for manual (cash/bank) payments and empty docs', () => {
    expect(docHasSquarePayment({ payments: [{ method: 'cash', amount: 100 }] })).toBe(false);
    expect(docHasSquarePayment({ payments: [] })).toBe(false);
    expect(docHasSquarePayment({})).toBe(false);
    expect(docHasSquarePayment(null)).toBe(false);
  });
});
