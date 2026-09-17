import { describe, it, expect } from 'vitest';
import {
  parseReturnTrialEmailConfig,
  returnTrialEmailCopy,
  returnTrialEmailVerdict,
  DEFAULT_RETURN_TRIAL_EMAIL_CONFIG,
  RETURN_TRIAL_EMAIL_SEND_ONCE_FIELD,
} from './returnTrialEmail.helpers';
import { returnTrialVerdict, returnClockPriorMs, RETURN_TRIAL_DAYS } from './returnTrial.helpers';
import { lastConversionSendMs, sentConversionEmailWithin } from './lifecycleEmails.helpers';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-20T21:30:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const lapsed = { isPro: false, trialStartedAt: iso(NOW - 90 * DAY), trialExpired: true };
const away45 = { lastActivityAt: iso(NOW - 45 * DAY) };

describe('returnTrialEmailVerdict — the email promises exactly what the ping grants', () => {
  it('sends to a lapsed trial away 30+ days that has not been emailed', () => {
    expect(returnTrialEmailVerdict({ sub: lapsed, emailState: away45, nowMs: NOW })).toEqual({
      send: true,
      inactiveDays: 45,
    });
  });

  it('agrees with the grant predicate on every reason', () => {
    const cases = [
      { sub: { ...lapsed, isPro: true }, es: away45 },
      { sub: { ...lapsed, productId: 'quotemate_pro_monthly' }, es: away45 },
      { sub: { isPro: false }, es: away45 },
      { sub: { ...lapsed, returnTrialGrantedAt: iso(NOW - 10 * DAY) }, es: away45 },
      { sub: { ...lapsed, trialStartedAt: iso(NOW - 2 * DAY) }, es: away45 },
      { sub: lapsed, es: { lastActivityAt: iso(NOW - 10 * DAY) } },
      { sub: lapsed, es: { lastActivityAt: iso(NOW - 10 * DAY), returnTrialClockAt: iso(NOW - 45 * DAY) } },
      { sub: lapsed, es: undefined },
    ];
    for (const c of cases) {
      const grant = returnTrialVerdict({ sub: c.sub, priorActivityMs: returnClockPriorMs(c.es), nowMs: NOW });
      const mail = returnTrialEmailVerdict({ sub: c.sub, emailState: c.es, nowMs: NOW });
      expect(mail.send).toBe(grant.grant);
      if (!grant.grant && !mail.send) expect(mail.reason).toBe(grant.reason);
    }
  });

  it('is send-once: an emailed account is never emailed again, even years later', () => {
    const es = { ...away45, [RETURN_TRIAL_EMAIL_SEND_ONCE_FIELD]: iso(NOW - DAY) };
    expect(returnTrialEmailVerdict({ sub: lapsed, emailState: es, nowMs: NOW })).toEqual({
      send: false,
      reason: 'already-emailed',
    });
    expect(returnTrialEmailVerdict({ sub: lapsed, emailState: es, nowMs: NOW + 400 * DAY }).send).toBe(false);
  });

  it('the send-once stamp counts as a conversion-campaign send for same-day drip suppression', () => {
    const es = { [RETURN_TRIAL_EMAIL_SEND_ONCE_FIELD]: iso(NOW - 60 * 60 * 1000) };
    expect(lastConversionSendMs(es)).toBe(NOW - 60 * 60 * 1000);
    expect(sentConversionEmailWithin(es, NOW)).toBe(true);
  });
});

describe('parseReturnTrialEmailConfig — off unless the doc says on', () => {
  it('missing, empty or malformed → disabled with the default cap', () => {
    expect(parseReturnTrialEmailConfig(undefined)).toEqual(DEFAULT_RETURN_TRIAL_EMAIL_CONFIG);
    expect(parseReturnTrialEmailConfig({})).toEqual(DEFAULT_RETURN_TRIAL_EMAIL_CONFIG);
    expect(parseReturnTrialEmailConfig({ enabled: 'true', dailyCap: 'lots' })).toEqual(DEFAULT_RETURN_TRIAL_EMAIL_CONFIG);
    expect(parseReturnTrialEmailConfig({ enabled: true, dailyCap: -3 }).dailyCap).toBe(DEFAULT_RETURN_TRIAL_EMAIL_CONFIG.dailyCap);
  });

  it('honours an explicit switch and cap', () => {
    expect(parseReturnTrialEmailConfig({ enabled: true, dailyCap: 10 })).toEqual({ enabled: true, dailyCap: 10 });
    expect(parseReturnTrialEmailConfig({ enabled: true, dailyCap: 0 })).toEqual({ enabled: true, dailyCap: 0 });
  });
});

describe('returnTrialEmailCopy', () => {
  it('states the real number of days and that it is the last one', () => {
    const c = returnTrialEmailCopy('Harbour Plumbing');
    expect(c.subject).toBe(`Harbour Plumbing, a fresh ${RETURN_TRIAL_DAYS} days of Pro is waiting`);
    expect(c.heading).toContain(`${RETURN_TRIAL_DAYS} days of Pro`);
    expect(c.intro).toContain(`fresh ${RETURN_TRIAL_DAYS} days of Pro`);
    expect(c.howItWorks).toContain('last free run');
    expect(c.whatsNew.length).toBeGreaterThanOrEqual(4);
  });

  it('falls back cleanly with no business name', () => {
    const c = returnTrialEmailCopy('');
    expect(c.subject).toBe(`A fresh ${RETURN_TRIAL_DAYS} days of Pro is waiting`);
    expect(c.intro.startsWith('Hi there.')).toBe(true);
  });

  it('never says "AI", stays gender-neutral, and never claims a first-trial length', () => {
    const c = returnTrialEmailCopy('Test');
    const all = [c.subject, c.preheader, c.heading, c.intro, ...c.whatsNew, c.howItWorks, c.cta].join(' ');
    expect(all).not.toMatch(/\bAI\b/);
    expect(all).not.toMatch(/\b(blokes?|guys|folks|fancy)\b/i);
    expect(all).not.toMatch(/7[- ]day free trial/i);
    expect(all).not.toMatch(/for 7 days/i);
  });
});
