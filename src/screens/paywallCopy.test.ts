import { describe, it, expect } from 'vitest';
import {
  QM_APP_FEE_PCT_ONLINE,
  QM_APP_FEE_PCT_ONLINE_FREE,
  QM_APP_FEE_PCT_IN_PERSON,
} from '../../shared/pdf/squareFees';
import {
  PRO_FEATURES,
  proFeeLine,
  paywallSubtitle,
  paywallHeaderNote,
  proTimeLine,
  describeMinutes,
  paywallPlanState,
  planRowSubtitle,
  proCtaLabel,
  billingLine,
  hasIntroOffer,
} from './paywallCopy';

describe('paywallCopy', () => {
  const everyLine = [
    ...PRO_FEATURES.map((f) => f.text),
    paywallSubtitle({ kind: 'pro' }),
    paywallSubtitle({ kind: 'free' }),
    paywallSubtitle({ kind: 'trial', daysRemaining: 3 }),
    paywallHeaderNote({ kind: 'trial', daysRemaining: 3 }),
    paywallHeaderNote({ kind: 'free' }),
    paywallSubtitle({ kind: 'trial_pending' }),
    paywallHeaderNote({ kind: 'trial_pending' }),
    planRowSubtitle({ kind: 'trial_pending' }),
    planRowSubtitle({ kind: 'trial', daysRemaining: 2 }),
    proCtaLabel('$49', 'monthly'),
    billingLine('$49', 'monthly'),
    paywallHeaderNote({ kind: 'trial', daysRemaining: 3 }, 14),
    paywallHeaderNote({ kind: 'trial_pending' }, 14),
    proCtaLabel('$49', 'monthly', 14),
    billingLine('$49', 'monthly', 14),
  ].filter((s): s is string => typeof s === 'string');

  it('never carries guilt or unsupported competitor claims', () => {
    // The old rotating quips: "your competitors just upgraded", "don't say we
    // didn't warn you", "your quotes will miss you". None of that is a claim
    // we can back, and a paywall that scolds converts nobody.
    const banned = /competitor|warn|miss you|deserve|they all say|no pressure/i;
    everyLine.forEach((line) => expect(line).not.toMatch(banned));
  });

  it('never says "AI" in user-facing copy', () => {
    everyLine.forEach((line) => expect(line).not.toMatch(/\bAI\b/));
  });

  it('never suggests a free account loses quotes or invoicing', () => {
    // Free keeps unlimited quotes and Square-linked invoicing, so Pro must not
    // be sold as "unlimited quotes and invoices".
    PRO_FEATURES.forEach((f) => expect(f.text).not.toMatch(/unlimited/i));
    expect(paywallHeaderNote({ kind: 'free' })).toMatch(/still work/);
  });

  it('derives the fee line from the fee model of record', () => {
    expect(proFeeLine()).toBe(
      'Lower fee on Square payments: 1% online and 1.5% in person, instead of 1.7%'
    );
    expect(proFeeLine()).toContain(`${QM_APP_FEE_PCT_ONLINE}% online`);
    expect(proFeeLine()).toContain(`${QM_APP_FEE_PCT_IN_PERSON}% in person`);
    expect(proFeeLine()).toContain(`instead of ${QM_APP_FEE_PCT_ONLINE_FREE}%`);
  });

  it('lists the fee line among the Pro features, each with an icon', () => {
    expect(PRO_FEATURES.map((f) => f.text)).toContain(proFeeLine());
    PRO_FEATURES.forEach((f) => {
      expect(f.icon.length).toBeGreaterThan(0);
      expect(f.text.length).toBeGreaterThan(0);
    });
  });

  it('describes the plan state in the subtitle', () => {
    expect(paywallSubtitle({ kind: 'pro' })).toBe('Pro is active on this account');
    expect(paywallSubtitle({ kind: 'free' })).toBe('Your free trial has ended');
    expect(paywallSubtitle({ kind: 'trial', daysRemaining: 1 })).toBe('1 day left in your free trial');
    expect(paywallSubtitle({ kind: 'trial', daysRemaining: 0 })).toBe('0 days left in your free trial');
    expect(paywallSubtitle({ kind: 'trial', daysRemaining: 14 })).toBe('14 days left in your free trial');
  });

  it('shows a header note only to accounts that are not yet Pro', () => {
    expect(paywallHeaderNote({ kind: 'pro' })).toBeNull();
    expect(paywallHeaderNote({ kind: 'trial', daysRemaining: 5 })).toMatch(/bills you today/);
    expect(paywallHeaderNote({ kind: 'free' })).toMatch(/Pro adds the rest/);
  });

  describe('proTimeLine', () => {
    it('prices Pro in minutes of the tradie\'s own labour at the rate they quote with', () => {
      // $49 / $110 an hour = 26.7 minutes.
      expect(proTimeLine(110, 49)).toBe(
        'At $110 an hour, Pro costs about 27 minutes of your time a month.',
      );
    });

    it('defaults to the list price of record, so it can never drift from pricingConfig', () => {
      expect(proTimeLine(85)).toBe(
        'At $85 an hour, Pro costs about 35 minutes of your time a month.',
      );
    });

    it('takes a per-month figure for the yearly plan', () => {
      expect(proTimeLine(110, 328 / 12)).toBe(
        'At $110 an hour, Pro costs about 15 minutes of your time a month.',
      );
    });

    it('renders nothing rather than a claim built on a missing or zero rate', () => {
      expect(proTimeLine(undefined)).toBeNull();
      expect(proTimeLine(null)).toBeNull();
      expect(proTimeLine(0)).toBeNull();
      expect(proTimeLine(-5)).toBeNull();
      expect(proTimeLine(Number.NaN)).toBeNull();
      expect(proTimeLine(110, 0)).toBeNull();
    });

    it('never calls the figure "your rate" — onboarding stores $85 when the field is left blank', () => {
      expect(proTimeLine(85)).not.toMatch(/your rate/i);
    });

    it('drops trailing zeros from a rate entered with cents', () => {
      expect(proTimeLine(97.5, 49)).toMatch(/^At \$97\.5 an hour/);
    });
  });

  describe('describeMinutes', () => {
    it('rounds to whole minutes under an hour and to half-hours above', () => {
      expect(describeMinutes(26.7)).toBe('27 minutes');
      expect(describeMinutes(0.4)).toBe('1 minute');
      expect(describeMinutes(58)).toBe('an hour');
      expect(describeMinutes(70)).toBe('an hour');
      expect(describeMinutes(80)).toBe('1½ hours');
      expect(describeMinutes(118)).toBe('2 hours');
      expect(describeMinutes(150)).toBe('2½ hours');
    });
  });

  describe('paywallPlanState', () => {
    const day = 24 * 60 * 60 * 1000;
    it('is pending until the first quote starts the clock', () => {
      expect(paywallPlanState({ isPro: false, trialExpired: false, trialStartedAt: null })).toEqual({
        kind: 'trial_pending',
      });
    });
    it('counts whole days left from trialStartedAt', () => {
      const now = 1_800_000_000_000;
      expect(
        paywallPlanState({ isPro: false, trialExpired: false, trialStartedAt: now - 3 * day, now }),
      ).toEqual({ kind: 'trial', daysRemaining: 11 });
    });
    it('is free once expired, pro when pro, whatever the clock says', () => {
      expect(paywallPlanState({ isPro: false, trialExpired: true, trialStartedAt: null }).kind).toBe('free');
      expect(paywallPlanState({ isPro: true, trialExpired: true, trialStartedAt: null }).kind).toBe('pro');
    });
  });

  describe('billing honesty', () => {
    it('tells a trial user that subscribing now bills today when the store reports no intro offer', () => {
      expect(paywallHeaderNote({ kind: 'trial', daysRemaining: 10 })).toMatch(/bills you today/);
      expect(paywallHeaderNote({ kind: 'trial_pending' })).toMatch(/bills you today/);
      expect(paywallHeaderNote({ kind: 'trial', daysRemaining: 10 })).not.toMatch(/keep it after/);
      // Null, zero and rubbish all mean "no offer" — never a free-days claim.
      expect(paywallHeaderNote({ kind: 'trial', daysRemaining: 10 }, 0)).toMatch(/bills you today/);
      expect(paywallHeaderNote({ kind: 'trial', daysRemaining: 10 }, Number.NaN)).toMatch(/bills you today/);
      expect(proCtaLabel('$49', 'monthly', 0)).toBe('Start Pro · $49/month');
      expect(billingLine('$49', 'monthly', null)).toMatch(/^Billed today/);
    });
    it('states the store\'s free days, in the store\'s number, when it has a live intro offer', () => {
      expect(paywallHeaderNote({ kind: 'trial', daysRemaining: 10 }, 14)).toBe(
        "You're on Pro for the rest of your trial. Start a subscription now and your first charge is 14 days away.",
      );
      expect(paywallHeaderNote({ kind: 'trial_pending' }, 14)).toMatch(/no charge for 14 days/);
      expect(paywallHeaderNote({ kind: 'trial', daysRemaining: 10 }, 14)).not.toMatch(/bills you today/);
      expect(proCtaLabel('$49', 'monthly', 14)).toBe('Start Pro · 14 days free');
      expect(proCtaLabel('$328', 'yearly', 7)).toBe('Start Pro · 7 days free');
      // The price moves to the billing line, so it is never ellipsised off a one-line button.
      expect(billingLine('$328', 'yearly', 7)).toMatch(/then \$328\/year/);
      expect(billingLine('$49', 'monthly', 14)).toMatch(/^No charge for 14 days, then \$49\/month/);
      expect(billingLine('$49', 'monthly', 14)).toMatch(/Cancel at least 24 hours before the 14 days end and you pay nothing/);
      expect(billingLine('$49', 'monthly', 14)).not.toMatch(/Billed today/);
      // Free and Pro notes do not change with the offer.
      expect(paywallHeaderNote({ kind: 'free' }, 14)).toMatch(/Pro adds the rest/);
      expect(paywallHeaderNote({ kind: 'pro' }, 14)).toBeNull();
    });
    it('hasIntroOffer is the one rule for "the store gives free days"', () => {
      expect(hasIntroOffer(14)).toBe(true);
      expect(hasIntroOffer(0)).toBe(false);
      expect(hasIntroOffer(-3)).toBe(false);
      expect(hasIntroOffer(null)).toBe(false);
      expect(hasIntroOffer(undefined)).toBe(false);
      expect(hasIntroOffer(Number.NaN)).toBe(false);
    });
    it('the pending state points at the first quote, on every surface', () => {
      expect(paywallSubtitle({ kind: 'trial_pending' })).toMatch(/starts with your first quote/);
      expect(planRowSubtitle({ kind: 'trial_pending' })).toMatch(/starts with your first quote/);
      expect(planRowSubtitle({ kind: 'trial', daysRemaining: 1 })).toBe('Pro trial · 1 day left');
      expect(planRowSubtitle({ kind: 'trial', daysRemaining: 0 })).toBe('Pro trial ends today');
      expect(planRowSubtitle({ kind: 'free' })).toBe('Free plan');
    });
    it('puts the price on the button and the charge date under it', () => {
      expect(proCtaLabel('$49', 'monthly')).toBe('Start Pro · $49/month');
      expect(proCtaLabel('$328', 'yearly')).toBe('Start Pro · $328/year');
      expect(billingLine('$49', 'monthly')).toMatch(/^Billed today, then \$49\/month/);
      expect(billingLine('$328', 'yearly')).toMatch(/auto-renewing yearly/);
    });
  });
});

describe('paywallPlanState honours a return trial (explicit trialEndsAt)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const NOW = Date.parse('2026-09-17T09:00:00.000Z');

  it('a lapsed 14-day trial re-opened for 7 days reads as a 7-day trial', () => {
    const lapsedStart = new Date(NOW - 60 * DAY_MS);
    expect(
      paywallPlanState({ isPro: false, trialExpired: false, trialStartedAt: lapsedStart, now: NOW }),
    ).toEqual({ kind: 'trial', daysRemaining: 0 });
    expect(
      paywallPlanState({
        isPro: false,
        trialExpired: false,
        trialStartedAt: lapsedStart,
        trialEndsAt: new Date(NOW + 7 * DAY_MS),
        now: NOW,
      }),
    ).toEqual({ kind: 'trial', daysRemaining: 7 });
  });
});
