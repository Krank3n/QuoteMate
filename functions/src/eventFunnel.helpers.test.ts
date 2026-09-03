import { describe, expect, it } from 'vitest';
import {
  EventFunnelUserInput,
  SendFlowFlags,
  SendFlowUserInput,
  OutcomeDocInput,
  RETURN_GAP_HOURS,
  bestOutcome,
  docHasSquarePayment,
  emptyAppOpenFlags,
  emptySendFlowFlags,
  foldEvent,
  furthestSendStage,
  furthestStage,
  isAcceptedDoc,
  isMonetized,
  isViewedDoc,
  parseSendMethod,
  rollupOutcomes,
  toMillis,
  sumSquarePayments,
  rollupEventFunnel,
  rollupSendFlow,
  summariseWaits,
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
    hasViewedDoc: false,
    hasAcceptedDoc: false,
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
    expect(furthestStage(user({ hasSentDoc: true, hasViewedDoc: true })).shared).toBe(
      'customer_viewed'
    );
    expect(
      furthestStage(user({ hasSentDoc: true, hasViewedDoc: true, hasAcceptedDoc: true })).shared
    ).toBe('quote_accepted');
  });

  it('an acceptance the tradie marked by hand still counts, with no view stamp at all', () => {
    // Marked accepted in the app: acceptedAt exists, firstViewedAt never did.
    expect(furthestStage(user({ hasSentDoc: true, hasAcceptedDoc: true })).shared).toBe(
      'quote_accepted'
    );
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

    expect(payload.shared).toEqual({
      signups: 5,
      quoteDraft: 4,
      quoteSent: 3,
      customerViewed: 0,
      quoteAccepted: 0,
    });
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
    expect(payload.conversion.sentToViewed).toBe(0);
    expect(payload.conversion.sentToAccepted).toBe(0);
    expect(payload.pathA.pctCheckoutStarted).toBe(0);
    expect(payload.pathB.pctFirstPayment).toBe(0);
  });

  it('counts the customer-outcome stages cumulatively and buckets monetised users by furthest stage', () => {
    const paidSub = { ...billedSub, trialStartedAt: trialSub.trialStartedAt };
    const inputs = [
      // Sent, customer never opened it, never paid.
      user({ uid: 'sent-only', sub: trialSub, hasSentDoc: true }),
      // Sent, customer opened it, never paid.
      user({ uid: 'viewed', sub: trialSub, hasSentDoc: true, hasViewedDoc: true }),
      // Sent, opened, accepted — and paid for Pro.
      user({
        uid: 'won-paid',
        sub: paidSub,
        hasSentDoc: true,
        hasViewedDoc: true,
        hasAcceptedDoc: true,
      }),
      // Accepted by hand (no view stamp) and collecting via Square.
      user({ uid: 'won-square', sub: trialSub, hasSentDoc: true, hasAcceptedDoc: true, hasSquarePayment: true }),
      // Paid without ever sending (the odd early adopter) — lands in quote_draft's bucket.
      user({ uid: 'paid-draft', sub: paidSub, hasQuoteDraft: true }),
    ];

    const payload = rollupEventFunnel(inputs, NOW, 30);

    expect(payload.shared).toEqual({
      signups: 5,
      quoteDraft: 5,
      quoteSent: 4,
      customerViewed: 3, // the hand-marked acceptance implies a view
      quoteAccepted: 2,
    });
    expect(payload.conversion.sentToViewed).toBe(3 / 4);
    expect(payload.conversion.sentToAccepted).toBe(2 / 4);
    expect(payload.histogram.shared).toEqual({
      signup: 0,
      quote_draft: 1,
      quote_sent: 1,
      customer_viewed: 1,
      quote_accepted: 2,
    });
    // The question the table exists to answer: does a won job predict paying?
    expect(payload.monetizedByStage).toEqual({
      signup: 0,
      quote_draft: 1,
      quote_sent: 0,
      customer_viewed: 0,
      quote_accepted: 2,
    });
    expect(payload.monetized.count).toBe(3);
  });

  it('rolls app_opened flags into return counts, and reads no events as zero', () => {
    const inputs = [
      user({
        uid: 'came-back-from-push',
        opens: { openedApp: true, returnedLater: true, returnedViaPush: true, pushTypes: ['quote_viewed'] },
      }),
      user({
        uid: 'two-pushes',
        opens: {
          openedApp: true,
          returnedLater: false,
          returnedViaPush: true,
          pushTypes: ['quote_viewed', 'invoice_paid'],
        },
      }),
      user({
        uid: 'same-sitting-only',
        opens: { openedApp: true, returnedLater: false, returnedViaPush: false, pushTypes: [] },
      }),
      user({ uid: 'no-events' }),
    ];
    expect(rollupEventFunnel(inputs, NOW, 30).returns).toEqual({
      opened: 3,
      returnedLater: 1,
      viaPush: 2,
      // Users per push type, so one user tapping two kinds counts in both.
      byPushType: { quote_viewed: 2, invoice_paid: 1 },
    });
  });
});

describe('foldAppOpenEvent (via foldEvent)', () => {
  it('a cold open with no previous open is an open, not a return', () => {
    const flags = foldEvent(undefined, 'app_opened', { source: 'cold', hours_since_last_open: null });
    expect(flags.openedApp).toBe(true);
    expect(flags.returnedLater).toBe(false);
    expect(flags.returnedViaPush).toBe(false);
  });

  it('a later sitting is a return; the same sitting resumed is not', () => {
    const same = foldEvent(undefined, 'app_opened', { source: 'foreground', hours_since_last_open: 0.2 });
    expect(same.returnedLater).toBe(false);
    const later = foldEvent(same, 'app_opened', {
      source: 'foreground',
      hours_since_last_open: RETURN_GAP_HOURS,
    });
    expect(later.returnedLater).toBe(true);
  });

  it('attributes a push-sourced open regardless of the gap, and remembers which push', () => {
    let flags = foldEvent(undefined, 'app_opened', {
      source: 'push',
      push_type: 'quote_viewed',
      hours_since_last_open: 0.1,
    });
    expect(flags.returnedViaPush).toBe(true);
    expect(flags.returnedLater).toBe(false);
    flags = foldEvent(flags, 'app_opened', { source: 'push', push_type: 'quote_viewed' });
    flags = foldEvent(flags, 'app_opened', { source: 'push', push_type: ' invoice_paid ' });
    flags = foldEvent(flags, 'app_opened', { source: 'push' }); // untyped push: attributed, unnamed
    expect(flags.pushTypes).toEqual(['quote_viewed', 'invoice_paid']);
  });

  it('degrades malformed props to "opened, details unknown"', () => {
    const flags = foldEvent(undefined, 'app_opened', { hours_since_last_open: 'yesterday' });
    expect(flags).toMatchObject({ openedApp: true, returnedLater: false, returnedViaPush: false });
    expect(foldEvent(undefined, 'app_opened', null).openedApp).toBe(true);
  });

  it('leaves the other flag bags alone', () => {
    const flags = foldEvent(undefined, 'app_opened', { source: 'push' });
    expect(flags.viewedPaywall).toBe(false);
    expect(flags.openedSendSheet).toBe(false);
  });
});

describe('isViewedDoc', () => {
  it('true on any of the acceptance page\'s view stamps', () => {
    expect(isViewedDoc({ firstViewedAt: { toMillis: () => NOW } })).toBe(true);
    expect(isViewedDoc({ lastViewedAt: NOW })).toBe(true);
    expect(isViewedDoc({ viewCount: 3 })).toBe(true);
  });

  it('false for an unstamped documents twin, a zero count, and nothing at all', () => {
    expect(isViewedDoc({ stage: 'quote_sent', sentAt: NOW })).toBe(false);
    expect(isViewedDoc({ viewCount: 0 })).toBe(false);
    expect(isViewedDoc(null)).toBe(false);
    expect(isViewedDoc(undefined)).toBe(false);
  });
});

describe('isAcceptedDoc', () => {
  it('true for the accepted stage, an acceptedAt stamp, or a quote turned invoice', () => {
    expect(isAcceptedDoc({ stage: 'quote_accepted' })).toBe(true);
    // Progressed past accepted but the stamp survived the transition.
    expect(isAcceptedDoc({ stage: 'paid', acceptedAt: NOW })).toBe(true);
    expect(isAcceptedDoc({ stage: 'invoice_sent', invoicedAt: NOW })).toBe(true);
  });

  it('true for a legacy customer accept: respondedAt on a doc the mirror moved on', () => {
    expect(isAcceptedDoc({ stage: 'invoice_sent', respondedAt: NOW })).toBe(true);
  });

  it('never for rejected or cancelled, whatever else is stamped', () => {
    expect(isAcceptedDoc({ stage: 'quote_rejected', respondedAt: NOW })).toBe(false);
    expect(isAcceptedDoc({ stage: 'cancelled', acceptedAt: NOW, invoicedAt: NOW })).toBe(false);
  });

  it('false for a plain sent quote and an invoice-only document', () => {
    expect(isAcceptedDoc({ stage: 'quote_sent', sentAt: NOW })).toBe(false);
    expect(isAcceptedDoc({ stage: 'invoice_sent', sentAt: NOW })).toBe(false);
    expect(isAcceptedDoc({ stage: 'paid' })).toBe(false);
    expect(isAcceptedDoc(null)).toBe(false);
  });
});

describe('foldEvent', () => {
  it('sets flags for the funnel events and de-dups repeats', () => {
    let flags = foldEvent(undefined, 'paywall_viewed');
    flags = foldEvent(flags, 'paywall_viewed');
    flags = foldEvent(flags, 'checkout_started');
    expect(flags).toEqual({
      viewedPaywall: true,
      startedCheckout: true,
      ...emptySendFlowFlags(),
      ...emptyAppOpenFlags(),
    });
  });

  it('ignores unrelated events without creating noise', () => {
    const flags = foldEvent(undefined, 'quote_started');
    expect(flags).toEqual({
      viewedPaywall: false,
      startedCheckout: false,
      ...emptySendFlowFlags(),
      ...emptyAppOpenFlags(),
    });
  });

  it('threads send-flow props through onto the same flag bag', () => {
    let flags = foldEvent(undefined, 'send_sheet_opened', { doc_type: 'quote', plan: 'trial' });
    flags = foldEvent(flags, 'send_method_chosen', { method: 'email', doc_type: 'quote' });
    flags = foldEvent(flags, 'email_preview_opened', { doc_type: 'quote', wait_ms: 4200 });
    flags = foldEvent(flags, 'quote_send_succeeded', { method: 'email', to_self: false });

    expect(flags.openedSendSheet).toBe(true);
    expect(flags.choseSendMethod).toBe(true);
    expect(flags.methods).toEqual(['email']);
    expect(flags.previewWaitMs).toEqual([4200]);
    expect(flags.sendSucceeded).toBe(true);
    expect(flags.sentToSelf).toBe(false);
    // Path A flags stay untouched by send-flow traffic.
    expect(flags.viewedPaywall).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SEND-FLOW SUB-FUNNEL
// ---------------------------------------------------------------------------

function sendFlags(over: Partial<SendFlowFlags> = {}): SendFlowFlags {
  return { ...emptySendFlowFlags(), ...over };
}

function sender(over: Partial<SendFlowUserInput> = {}): SendFlowUserInput {
  return { hasSentDoc: false, ...over };
}

describe('parseSendMethod', () => {
  it('accepts the four contracted methods and rejects anything else', () => {
    expect(parseSendMethod('email')).toBe('email');
    expect(parseSendMethod('sms')).toBe('sms');
    expect(parseSendMethod('share')).toBe('share');
    expect(parseSendMethod('export_pdf')).toBe('export_pdf');
    expect(parseSendMethod('carrier_pigeon')).toBeNull();
    expect(parseSendMethod(undefined)).toBeNull();
    expect(parseSendMethod(7)).toBeNull();
  });
});

describe('foldSendEvent (via foldEvent)', () => {
  it('collects every method a tradie tried, without duplicates', () => {
    let flags = foldEvent(undefined, 'send_method_chosen', { method: 'email' });
    flags = foldEvent(flags, 'send_method_chosen', { method: 'email' });
    flags = foldEvent(flags, 'send_method_chosen', { method: 'sms' });
    expect(flags.methods).toEqual(['email', 'sms']);
  });

  it('records a step even when its props are missing or malformed', () => {
    let flags = foldEvent(undefined, 'send_method_chosen', undefined);
    flags = foldEvent(flags, 'email_preview_opened', 'not-an-object');
    expect(flags.choseSendMethod).toBe(true);
    expect(flags.methods).toEqual([]);
    expect(flags.openedEmailPreview).toBe(true);
    expect(flags.previewWaitMs).toEqual([]);
  });

  it('keeps one wait sample per preview open, dropping clock-skew values', () => {
    let flags = foldEvent(undefined, 'email_preview_opened', { wait_ms: 1200 });
    flags = foldEvent(flags, 'email_preview_opened', { wait_ms: 3400 });
    flags = foldEvent(flags, 'email_preview_opened', { wait_ms: -50 });
    flags = foldEvent(flags, 'email_preview_opened', { wait_ms: 'soon' });
    expect(flags.previewWaitMs).toEqual([1200, 3400]);
  });

  it('flags a self-addressed send only when to_self is literally true', () => {
    expect(foldEvent(undefined, 'quote_send_succeeded', { to_self: true }).sentToSelf).toBe(true);
    expect(foldEvent(undefined, 'quote_send_succeeded', { to_self: 'yes' }).sentToSelf).toBe(false);
    expect(foldEvent(undefined, 'quote_send_succeeded', {}).sentToSelf).toBe(false);
  });

  it('records an abandoned preview', () => {
    const flags = foldEvent(undefined, 'email_preview_abandoned', {
      doc_type: 'quote',
      had_recipient: true,
      edited_body: false,
    });
    expect(flags.abandonedEmailPreview).toBe(true);
  });
});

describe('summariseWaits', () => {
  it('reports the middle value for an odd sample count', () => {
    expect(summariseWaits([3000, 1000, 2000])).toEqual({
      samples: 3,
      median: 2000,
      p90: 3000,
      max: 3000,
    });
  });

  it('averages the two middle values for an even sample count', () => {
    expect(summariseWaits([1000, 2000, 3000, 5000]).median).toBe(2500);
  });

  it('p90 is nearest-rank, so one slow outlier cannot drag the median', () => {
    const samples = [...Array(9).fill(1000), 60000];
    const summary = summariseWaits(samples);
    expect(summary.median).toBe(1000);
    expect(summary.p90).toBe(1000);
    expect(summary.max).toBe(60000);
  });

  it('drops unusable samples and never divides by zero', () => {
    expect(summariseWaits([])).toEqual({ samples: 0, median: 0, p90: 0, max: 0 });
    expect(summariseWaits([NaN, -1, Infinity])).toEqual({
      samples: 0,
      median: 0,
      p90: 0,
      max: 0,
    });
    expect(summariseWaits([NaN, 500, -1]).samples).toBe(1);
  });
});

describe('furthestSendStage', () => {
  it('is null for anyone who never entered the send flow', () => {
    expect(furthestSendStage(sender())).toBeNull();
    expect(furthestSendStage(sender({ send: sendFlags() }))).toBeNull();
  });

  it('orders the steps sheet → method → preview', () => {
    expect(furthestSendStage(sender({ send: sendFlags({ openedSendSheet: true }) }))).toBe(
      'send_sheet_opened'
    );
    expect(furthestSendStage(sender({ send: sendFlags({ choseSendMethod: true }) }))).toBe(
      'method_chosen'
    );
    expect(furthestSendStage(sender({ send: sendFlags({ openedEmailPreview: true }) }))).toBe(
      'email_preview_opened'
    );
  });

  it('an abandoned preview implies an opened one (either write can go missing)', () => {
    expect(furthestSendStage(sender({ send: sendFlags({ abandonedEmailPreview: true }) }))).toBe(
      'email_preview_opened'
    );
  });

  it('durable evidence wins: a doc past draft is a send with no event at all', () => {
    expect(furthestSendStage(sender({ hasSentDoc: true }))).toBe('quote_sent');
    // …and it still wins when the events say they only got as far as the sheet.
    expect(
      furthestSendStage(sender({ hasSentDoc: true, send: sendFlags({ openedSendSheet: true }) }))
    ).toBe('quote_sent');
  });

  it('a quote_send_succeeded event alone is enough when the doc lags', () => {
    expect(furthestSendStage(sender({ send: sendFlags({ sendSucceeded: true }) }))).toBe(
      'quote_sent'
    );
  });
});

describe('rollupSendFlow', () => {
  it('measures reach, drop-off and the stall histogram across the flow', () => {
    const inputs: SendFlowUserInput[] = [
      // Opened the sheet, picked nothing — the darkest cohort.
      sender({ send: sendFlags({ openedSendSheet: true }) }),
      // Picked email, never reached the preview.
      sender({ send: sendFlags({ openedSendSheet: true, choseSendMethod: true, methods: ['email'] }) }),
      // Reached the preview, bailed, never sent — the leak we're hunting.
      sender({
        send: sendFlags({
          openedSendSheet: true,
          choseSendMethod: true,
          methods: ['email'],
          openedEmailPreview: true,
          abandonedEmailPreview: true,
          previewWaitMs: [6000],
        }),
      }),
      // Bailed once, came back and sent it — abandonment isn't always fatal.
      sender({
        hasSentDoc: true,
        send: sendFlags({
          openedSendSheet: true,
          choseSendMethod: true,
          methods: ['email'],
          openedEmailPreview: true,
          abandonedEmailPreview: true,
          sendSucceeded: true,
          previewWaitMs: [2000],
        }),
      }),
      // Sent by SMS — never sees a preview, so must not count as one.
      sender({
        hasSentDoc: true,
        send: sendFlags({
          openedSendSheet: true,
          choseSendMethod: true,
          methods: ['sms'],
          sendSucceeded: true,
        }),
      }),
      // Pre-instrumentation sender: durable doc, not a single event.
      sender({ hasSentDoc: true }),
      // Never opened the send sheet at all — outside this funnel entirely.
      sender(),
    ];

    const out = rollupSendFlow(inputs);

    expect(out.sheetOpened).toBe(6);
    expect(out.methodChosen).toBe(5); // the sheet-only user is the one that drops
    expect(out.sent).toBe(3);
    expect(out.pctMethodChosen).toBe(5 / 6);
    expect(out.pctSent).toBe(3 / 5);

    // Preview counts are email-branch only: the SMS sender and the
    // pre-instrumentation sender are deliberately absent.
    expect(out.email.previewOpened).toBe(2);
    expect(out.email.previewAbandoned).toBe(2);
    expect(out.email.abandonedThenSent).toBe(1);
    expect(out.email.pctPreviewOpened).toBe(2 / 3); // of the 3 who picked email
    expect(out.email.pctPreviewAbandoned).toBe(1);
    expect(out.email.waitMs).toEqual({ samples: 2, median: 4000, p90: 6000, max: 6000 });

    expect(out.methods).toEqual({ email: 3, sms: 1, share: 0, export_pdf: 0 });
    expect(out.durableOnlySends).toBe(1);
    expect(out.selfSends).toBe(0);

    // The histogram is the stall picture, and it sums to everyone who entered.
    expect(out.histogram).toEqual({
      send_sheet_opened: 1,
      method_chosen: 1,
      email_preview_opened: 1,
      quote_sent: 3,
    });
    const entered = Object.values(out.histogram).reduce((a, b) => a + b, 0);
    expect(entered).toBe(out.sheetOpened);
  });

  it('counts a self-addressed send as a send, but names it separately', () => {
    const out = rollupSendFlow([
      sender({
        hasSentDoc: true,
        send: sendFlags({
          openedSendSheet: true,
          choseSendMethod: true,
          methods: ['email'],
          sendSucceeded: true,
          sentToSelf: true,
        }),
      }),
    ]);
    expect(out.sent).toBe(1);
    expect(out.selfSends).toBe(1);
  });

  it('a tradie who tried two methods lands in both columns, once each', () => {
    const out = rollupSendFlow([
      sender({ send: sendFlags({ openedSendSheet: true, choseSendMethod: true, methods: ['email', 'share'] }) }),
    ]);
    expect(out.methods).toEqual({ email: 1, sms: 0, share: 1, export_pdf: 0 });
    expect(out.methodChosen).toBe(1);
  });

  it('zero denominators produce 0, never NaN', () => {
    const out = rollupSendFlow([]);
    expect(out.pctMethodChosen).toBe(0);
    expect(out.pctSent).toBe(0);
    expect(out.email.pctPreviewOpened).toBe(0);
    expect(out.email.pctPreviewAbandoned).toBe(0);
    expect(out.email.waitMs.samples).toBe(0);
    expect(out.histogram.quote_sent).toBe(0);
  });

  it('rides along on the main payload so the cron writes one document', () => {
    const payload = rollupEventFunnel(
      [user({ uid: 'a', hasSentDoc: true, send: sendFlags({ openedSendSheet: true, sendSucceeded: true }) })],
      NOW,
      30
    );
    expect(payload.sendFlow.sheetOpened).toBe(1);
    expect(payload.sendFlow.sent).toBe(1);
    expect(payload.shared.quoteSent).toBe(1);
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

describe('sumSquarePayments', () => {
  it('sums only the square-sourced entries', () => {
    expect(sumSquarePayments({ payments: [{ method: 'square', amount: 100 }] })).toBe(100);
    expect(sumSquarePayments({ payments: [{ squarePaymentId: 'sq-1', amount: 50 }] })).toBe(50);
  });

  it('excludes the manual slice of a mixed-method document', () => {
    // Square deposit + bank-transfer balance: only the deposit monetises.
    expect(
      sumSquarePayments({
        payments: [
          { method: 'square', squarePaymentId: 'sq-1', amount: 200 },
          { method: 'bank', kind: 'manual', amount: 578.32 },
        ],
      })
    ).toBe(200);
  });

  it('returns 0 for manual-only, empty and malformed docs', () => {
    expect(sumSquarePayments({ payments: [{ method: 'bank', amount: 578.32 }] })).toBe(0);
    expect(sumSquarePayments({ payments: [] })).toBe(0);
    expect(sumSquarePayments({})).toBe(0);
    expect(sumSquarePayments(null)).toBe(0);
    expect(sumSquarePayments({ payments: [{ method: 'square', amount: 'oops' }] })).toBe(0);
  });
});

describe('summariseWaits with decimals', () => {
  it('keeps one decimal when asked, so sub-hour medians survive', () => {
    expect(summariseWaits([0.25, 0.4, 1.75], 1)).toEqual({ samples: 3, median: 0.4, p90: 1.8, max: 1.8 });
    // Default is still whole numbers (the ms callers).
    expect(summariseWaits([0.25, 0.4, 1.75]).median).toBe(0);
  });
});

describe('toMillis', () => {
  it('reads every timestamp shape the two collections hold', () => {
    expect(toMillis(NOW)).toBe(NOW);
    expect(toMillis({ toMillis: () => NOW })).toBe(NOW);
    expect(toMillis(new Date(NOW))).toBe(NOW);
    expect(toMillis('2026-07-16T00:00:00.000Z')).toBe(NOW);
  });

  it('is null for missing, malformed and non-finite values', () => {
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis(null)).toBeNull();
    expect(toMillis('yesterday')).toBeNull();
    expect(toMillis(NaN)).toBeNull();
    expect(toMillis({})).toBeNull();
  });
});

describe('bestOutcome', () => {
  it('ranks accepted > rejected > opened > never, over all of a sender\'s quotes', () => {
    const never = { accepted: false, rejected: false, firstViewedAt: null };
    const opened = { accepted: false, rejected: false, firstViewedAt: NOW };
    const rejected = { accepted: false, rejected: true, firstViewedAt: NOW };
    const accepted = { accepted: true, rejected: false, firstViewedAt: null };
    expect(bestOutcome([])).toBe('never_opened');
    expect(bestOutcome([never])).toBe('never_opened');
    expect(bestOutcome([never, opened])).toBe('opened_no_answer');
    expect(bestOutcome([opened, rejected])).toBe('rejected');
    // A hand-marked acceptance with no view stamp still outranks a rejection.
    expect(bestOutcome([rejected, accepted])).toBe('accepted');
  });
});

describe('rollupOutcomes', () => {
  const H = 60 * 60 * 1000;
  const doc = (over: Partial<OutcomeDocInput>): OutcomeDocInput => ({
    uid: 'u',
    sentAt: NOW,
    firstViewedAt: null,
    acceptedAt: null,
    accepted: false,
    rejected: false,
    sendMethod: 'email',
    withLink: true,
    ...over,
  });
  const paidSub = { ...billedSub, trialStartedAt: trialSub.trialStartedAt };

  it('buckets every sender exactly once, with the monetised count per bucket', () => {
    const inputs = [
      user({ uid: 'never', sub: paidSub, hasSentDoc: true }),
      user({ uid: 'opened', sub: trialSub, hasSentDoc: true }),
      user({ uid: 'rejected', sub: trialSub, hasSentDoc: true }),
      user({ uid: 'won', sub: paidSub, hasSentDoc: true }),
      user({ uid: 'won-by-hand', sub: trialSub, hasSentDoc: true, hasSquarePayment: true }),
      // Sent an invoice only — no quote rows — still a sender, lands in never_opened.
      user({ uid: 'invoice-only', sub: trialSub, hasSentDoc: true }),
      // Legacy quote with no documents twin: no rows, no hasSentDoc, but a
      // customer opened it — a sender by the ladder's rules, bucketed by flags.
      user({ uid: 'twinless-viewed', sub: trialSub, hasViewedDoc: true }),
      user({ uid: 'drafter', sub: trialSub, hasQuoteDraft: true }),
    ];
    const docs = [
      doc({ uid: 'never' }),
      doc({ uid: 'opened', firstViewedAt: NOW + 2 * H }),
      doc({ uid: 'rejected', firstViewedAt: NOW + H, rejected: true }),
      doc({ uid: 'won', firstViewedAt: NOW + 0.5 * H, accepted: true, acceptedAt: NOW + 3 * H }),
      doc({ uid: 'won', firstViewedAt: null }), // their second quote, never opened
      doc({ uid: 'won-by-hand', accepted: true, acceptedAt: NOW + 48 * H }),
      // Not a sender in the population (test account filtered upstream) — ignored.
      doc({ uid: 'ghost', firstViewedAt: NOW, accepted: true }),
    ];

    const o = rollupOutcomes(docs, inputs);

    expect(o.senders).toBe(7);
    expect(o.buckets).toEqual({ never_opened: 2, opened_no_answer: 2, rejected: 1, accepted: 2 });
    expect(o.monetized).toEqual({ never_opened: 1, opened_no_answer: 0, rejected: 0, accepted: 2 });
    // Raw opens: the hand-marked acceptance never had its link opened; the
    // twin-less legacy view counts through its flag.
    expect(o.openedLink).toBe(4);
    expect(o.quotes).toEqual({ sent: 6, withLink: 6, opened: 3, accepted: 2, rejected: 1 });
  });

  it('agrees with the ladder on who is a sender, so the two panels never disagree', () => {
    const inputs = [
      user({ uid: 'sent', hasSentDoc: true }),
      user({ uid: 'accepted-only-flag', hasAcceptedDoc: true }),
      user({ uid: 'drafter', hasQuoteDraft: true }),
    ];
    const payload = rollupEventFunnel(inputs, NOW, 30, []);
    expect(payload.outcomes.senders).toBe(payload.shared.quoteSent);
    expect(payload.outcomes.buckets.accepted).toBe(1);
  });

  it('measures time to open and time to accept per quote, in hours to one decimal', () => {
    const inputs = [user({ uid: 'u', hasSentDoc: true })];
    const docs = [
      doc({ firstViewedAt: NOW + 0.25 * H }),
      doc({ firstViewedAt: NOW + 6 * H, accepted: true, acceptedAt: NOW + 30 * H }),
      doc({ firstViewedAt: NOW + 72 * H, accepted: true, acceptedAt: NOW + 100 * H }),
      // Accepted with no known accept time contributes to counts, not timing.
      doc({ accepted: true }),
      // Sent time unknown — no interval can be measured.
      doc({ sentAt: null, firstViewedAt: NOW + H }),
      // Viewed "before" it was sent (re-sent later): dropped, not negative.
      doc({ firstViewedAt: NOW - H }),
    ];
    const o = rollupOutcomes(docs, inputs);
    expect(o.hoursToOpen).toEqual({ samples: 3, median: 6, p90: 72, max: 72 });
    expect(o.hoursToAccept).toEqual({ samples: 2, median: 65, p90: 100, max: 100 });
  });

  it('splits sent / linked / opened / accepted by the channel the quote went out on', () => {
    const inputs = [user({ uid: 'u', hasSentDoc: true })];
    const docs = [
      doc({ sendMethod: 'email' }),
      doc({ sendMethod: 'email', firstViewedAt: NOW }),
      doc({ sendMethod: 'sms', firstViewedAt: NOW, accepted: true }),
      // A PDF share carries no link, so it can never be opened.
      doc({ sendMethod: 'export_pdf', withLink: false }),
      // Token fields lost but a customer opened it: the open proves the link.
      doc({ sendMethod: 'sms', withLink: false, firstViewedAt: NOW }),
      doc({ sendMethod: null }),
    ];
    const o = rollupOutcomes(docs, inputs);
    expect(o.bySendMethod).toEqual({
      email: { sent: 2, withLink: 2, opened: 1, accepted: 0 },
      sms: { sent: 2, withLink: 2, opened: 2, accepted: 1 },
      export_pdf: { sent: 1, withLink: 0, opened: 0, accepted: 0 },
      unknown: { sent: 1, withLink: 1, opened: 0, accepted: 0 },
    });
    expect(o.quotes.withLink).toBe(5);
  });

  it('is all zeros with no senders, and rides on the main payload', () => {
    const empty = rollupOutcomes([], []);
    expect(empty.senders).toBe(0);
    expect(empty.hoursToOpen.samples).toBe(0);
    expect(rollupEventFunnel([], NOW, 30).outcomes).toEqual(empty);
  });
});
