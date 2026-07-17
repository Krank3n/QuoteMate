import { describe, expect, it } from 'vitest';
import {
  nextBestAction,
  docHasRealSquarePayment,
  NBA_ENDING_THRESHOLD_DAYS,
  REPEAT_PRO_USE_MIN,
  type NextBestActionInput,
  type NextBestActionDoc,
} from './nextBestAction';
import { TRIAL_MS } from './trialConfig';

const NOW = 1_800_000_000_000; // fixed, injected — the model never reads the clock
const DAY_MS = 24 * 60 * 60 * 1000;

const doc = (stage: NextBestActionDoc['stage'], payments?: NextBestActionDoc['payments']): NextBestActionDoc => ({
  stage,
  payments,
});

const base = (over: Partial<NextBestActionInput> = {}): NextBestActionInput => ({
  plan: 'trial',
  trialStartedAt: NOW - 2 * DAY_MS, // day 2 — mid-trial by default
  docs: [],
  hasSquareConnection: false,
  proFeatureUses: 0,
  happyOnFree: false,
  now: NOW,
  ...over,
});

describe('state table (high-intent-conversion-plan.md Intervention 0)', () => {
  it('no documents → create_first_quote, and never with pricing', () => {
    const r = nextBestAction(base());
    expect(r.key).toBe('create_first_quote');
    expect(r.sellingAllowed).toBe(false);
  });

  it('draft exists, nothing ever sent → send_first_quote, no pricing', () => {
    const r = nextBestAction(base({ docs: [doc('draft')] }));
    expect(r.key).toBe('send_first_quote');
    expect(r.sellingAllowed).toBe(false);
  });

  it('sent quote awaiting a response → follow_up, not a generic upgrade', () => {
    const r = nextBestAction(base({ docs: [doc('quote_sent')] }));
    expect(r.key).toBe('follow_up');
    expect(r.sellingAllowed).toBe(false);
  });

  it('accepted quote with no real payment → take_deposit', () => {
    const r = nextBestAction(base({ docs: [doc('quote_accepted')] }));
    expect(r.key).toBe('take_deposit');
    expect(r.sellingAllowed).toBe(false);
    expect(r.needsSquareConnect).toBe(true);
  });

  it('take_deposit does not ask for a Square connect that already exists', () => {
    const r = nextBestAction(base({ docs: [doc('invoice_sent')], hasSquareConnection: true }));
    expect(r.key).toBe('take_deposit');
    expect(r.needsSquareConnect).toBe(false);
  });

  it('trial ending (≤3 days) → continuity_choice with pricing allowed', () => {
    const r = nextBestAction(
      base({
        trialStartedAt: NOW - (TRIAL_MS - NBA_ENDING_THRESHOLD_DAYS * DAY_MS),
        docs: [doc('paid', [{ method: 'square', amount: 500, paidAt: NOW - DAY_MS }])],
      })
    );
    expect(r.key).toBe('continuity_choice');
    expect(r.sellingAllowed).toBe(true);
    expect(r.trialDaysRemaining).toBe(NBA_ENDING_THRESHOLD_DAYS);
  });

  it('repeated Pro-feature use mid-trial → keep_pro_tools', () => {
    const r = nextBestAction(
      base({
        proFeatureUses: REPEAT_PRO_USE_MIN,
        docs: [doc('quote_rejected')], // sent-tier, nothing collectable or awaiting response
      })
    );
    expect(r.key).toBe('keep_pro_tools');
    expect(r.sellingAllowed).toBe(true);
  });

  it('free user with meaningful Square volume → fee_comparison on real fees', () => {
    // $1,000 collected in-window → $7/mo saving, above the $5 claim threshold.
    const r = nextBestAction(
      base({
        plan: 'free',
        trialStartedAt: NOW - TRIAL_MS - 5 * DAY_MS,
        hasSquareConnection: true,
        docs: [doc('paid', [{ method: 'square', amount: 1000, paidAt: NOW - DAY_MS }])],
      })
    );
    expect(r.key).toBe('fee_comparison');
    expect(r.sellingAllowed).toBe(true);
  });

  it('free user with thin volume gets complete_via_square, never a thin fee claim', () => {
    const r = nextBestAction(
      base({
        plan: 'free',
        trialStartedAt: NOW - TRIAL_MS - 5 * DAY_MS,
        hasSquareConnection: true,
        docs: [doc('paid', [{ method: 'square', amount: 100, paidAt: NOW - DAY_MS }])],
      })
    );
    expect(r.key).toBe('complete_via_square');
    expect(r.sellingAllowed).toBe(false);
  });
});

describe('precedence: money and activation beat every subscription ask', () => {
  it('take_deposit outranks continuity_choice even on the last trial day', () => {
    const r = nextBestAction(
      base({
        trialStartedAt: NOW - (TRIAL_MS - 1 * DAY_MS),
        docs: [doc('quote_accepted')],
      })
    );
    expect(r.key).toBe('take_deposit');
  });

  it('manual cash on an accepted quote does NOT settle the money moment', () => {
    const r = nextBestAction(
      base({ docs: [doc('quote_accepted', [{ method: 'cash', amount: 500, paidAt: NOW }])] })
    );
    expect(r.key).toBe('take_deposit');
  });

  it('a real Square payment settles it — accepted+paid doc stops demanding a deposit', () => {
    const r = nextBestAction(
      base({ docs: [doc('partially_paid', [{ method: 'square', amount: 500, paidAt: NOW - DAY_MS }])] })
    );
    expect(r.key).not.toBe('take_deposit');
  });

  it('activation outranks keep_pro_tools: heavy Pro use with only drafts still says send it', () => {
    const r = nextBestAction(base({ proFeatureUses: 5, docs: [doc('draft')] }));
    expect(r.key).toBe('send_first_quote');
  });
});

describe('suppression: Pro users and happy-on-Free never get generic asks', () => {
  it('Pro user with settled jobs → none', () => {
    const r = nextBestAction(
      base({
        plan: 'pro',
        proFeatureUses: 10,
        docs: [doc('paid', [{ method: 'square', amount: 900, paidAt: NOW - DAY_MS }])],
      })
    );
    expect(r.key).toBe('none');
    expect(r.sellingAllowed).toBe(false);
  });

  it('Pro user still gets the money moment', () => {
    const r = nextBestAction(base({ plan: 'pro', docs: [doc('invoice_sent')] }));
    expect(r.key).toBe('take_deposit');
  });

  it('happy on Free suppresses fee_comparison and routes to the job', () => {
    const r = nextBestAction(
      base({
        plan: 'free',
        happyOnFree: true,
        hasSquareConnection: true,
        trialStartedAt: NOW - TRIAL_MS - 5 * DAY_MS,
        docs: [doc('paid', [{ method: 'square', amount: 5000, paidAt: NOW - DAY_MS }])],
      })
    );
    expect(r.key).toBe('complete_via_square');
    expect(r.sellingAllowed).toBe(false);
  });

  it('happy on Free during a live trial still gets follow_up, never continuity', () => {
    const r = nextBestAction(
      base({
        happyOnFree: true,
        trialStartedAt: NOW - (TRIAL_MS - 1 * DAY_MS),
        docs: [doc('quote_sent')],
      })
    );
    expect(r.key).toBe('follow_up');
  });
});

describe('trialDaysRemaining', () => {
  it('is null when not trialing and 0-floored at expiry boundary', () => {
    expect(nextBestAction(base({ plan: 'free', trialStartedAt: null })).trialDaysRemaining).toBeNull();
    const r = nextBestAction(base({ trialStartedAt: NOW - TRIAL_MS }));
    expect(r.trialDaysRemaining).toBe(0);
  });

  it('uses ceil like deriveSubFields: 2.5 days left reports 3', () => {
    const r = nextBestAction(base({ trialStartedAt: NOW - (TRIAL_MS - 2.5 * DAY_MS) }));
    expect(r.trialDaysRemaining).toBe(3);
  });
});

describe('docHasRealSquarePayment mirror (functions/src/eventFunnel.helpers.ts docHasSquarePayment)', () => {
  it('matches the server rule: method square OR squarePaymentId; cash/empty never', () => {
    expect(docHasRealSquarePayment(doc('paid', [{ method: 'square' }]))).toBe(true);
    expect(docHasRealSquarePayment(doc('paid', [{ squarePaymentId: 'sq_123' }]))).toBe(true);
    expect(docHasRealSquarePayment(doc('paid', [{ method: 'cash' }]))).toBe(false);
    expect(docHasRealSquarePayment(doc('paid', []))).toBe(false);
    expect(docHasRealSquarePayment(doc('paid'))).toBe(false);
    expect(docHasRealSquarePayment(null)).toBe(false);
  });
});
