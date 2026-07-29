import { describe, it, expect } from 'vitest';
import {
  computeFunnelStats,
  isActivatingDoc,
  isRecoveredDocId,
  isTestAccount,
  safeRatio,
  type FunnelUserInput,
} from './adminFunnel.helpers';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-02T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

// Minimal builder so each fixture only states what matters.
function user(over: Partial<FunnelUserInput>): FunnelUserInput {
  return {
    uid: over.uid || 'u',
    email: over.email ?? `${over.uid || 'u'}@example.com`,
    businessName: over.businessName ?? null,
    sub: 'sub' in over ? over.sub : null,
    signupAt: 'signupAt' in over ? (over.signupAt as number | null) : NOW - 10 * DAY,
    lastActivityAt: 'lastActivityAt' in over ? (over.lastActivityAt as number | null) : null,
    hasSentDoc: over.hasSentDoc ?? false,
  };
}

describe('trial→paid rate — paying counts only real billed subs; startedTrial counts every trialStartedAt', () => {
  const inputs: FunnelUserInput[] = [
    // trialing: trial started recently, not pro
    user({ uid: 'trialing', sub: { trialStartedAt: iso(NOW - 2 * DAY) } }),
    // trial_expired: trial started long ago, not pro
    user({ uid: 'expired', sub: { trialStartedAt: iso(NOW - 30 * DAY) } }),
    // admin comp Pro: isPro but platform admin_grant, no trial
    user({ uid: 'comp', sub: { isPro: true, platform: 'admin_grant' } }),
    // Stripe-billed Pro who converted from a trial
    user({ uid: 'stripe', sub: { isPro: true, platform: 'web', subscriptionId: 'sub_123', trialStartedAt: iso(NOW - 40 * DAY) } }),
    // bare isPro flag with no product/subscription/price id (owner/test/orphan)
    user({ uid: 'bare', sub: { isPro: true } }),
  ];
  const out = computeFunnelStats(inputs, NOW);

  it('counts ONLY the Stripe-billed sub as paying', () => {
    expect(out.funnel.paying).toBe(1);
  });
  it('counts every sub with a trialStartedAt as startedTrial (trialing + expired + now-pro)', () => {
    expect(out.funnel.startedTrial).toBe(3);
  });
  it('reports trialToPaid = paying / startedTrial = 1/3', () => {
    expect(out.conversion.trialToPaid).toBeCloseTo(1 / 3, 10);
  });
});

// The two data-quality filters every funnel, audit and oracle shares. Getting
// either wrong quietly inflates activation, so they're pinned here.
describe('isTestAccount', () => {
  it('catches our seeded accounts on either the email or the display name', () => {
    expect(isTestAccount('someone@example.com')).toBe(true);
    expect(isTestAccount('mate.debug+3@gmail.com')).toBe(true);
    expect(isTestAccount('newtestuser99@gmail.com')).toBe(true);
    expect(isTestAccount('testuser@quotemateapp.au')).toBe(true);
    expect(isTestAccount(null, 'qm-marketing-demo')).toBe(true);
  });

  it('leaves real tradies alone', () => {
    expect(isTestAccount('craig@warragulfencing.com.au', 'Warragul Fencing')).toBe(false);
    // "example" only counts as the email domain, not anywhere in the string.
    expect(isTestAccount('jo@example.com.au')).toBe(false);
    expect(isTestAccount(null, null)).toBe(false);
    expect(isTestAccount(undefined)).toBe(false);
  });
});

describe('isRecoveredDocId', () => {
  it('flags the 2026-07 email-derived reconstructions', () => {
    expect(isRecoveredDocId('recovered-QU-177696')).toBe(true);
    expect(isRecoveredDocId('recovered-idx25')).toBe(true);
  });

  it('leaves tradie-authored documents alone', () => {
    expect(isRecoveredDocId('QU-177696')).toBe(false);
    // Prefix only — a doc that merely mentions the word is not a rebuild.
    expect(isRecoveredDocId('quote-recovered-1')).toBe(false);
    expect(isRecoveredDocId(null)).toBe(false);
    expect(isRecoveredDocId(undefined)).toBe(false);
  });
});

describe('activation — stage !== draft is primary, sentAt only a fallback', () => {
  it('isActivatingDoc: draft not activated; quote_sent activated; missing stage not activated', () => {
    expect(isActivatingDoc({ stage: 'draft' })).toBe(false);
    expect(isActivatingDoc({ stage: 'quote_sent' })).toBe(true);
    expect(isActivatingDoc({})).toBe(false);
    expect(isActivatingDoc(null)).toBe(false);
  });
  it('isActivatingDoc: a sent-stage doc with NO sentAt still counts (35% lack sentAt)', () => {
    expect(isActivatingDoc({ stage: 'quote_sent', sentAt: undefined })).toBe(true);
    expect(isActivatingDoc({ stage: 'invoice_sent' })).toBe(true);
  });
  it('isActivatingDoc: a draft that somehow has a sentAt uses the fallback signal', () => {
    expect(isActivatingDoc({ stage: 'draft', sentAt: NOW })).toBe(true);
  });
  it('funnel sentQuote counts users flagged hasSentDoc, not draft-only ones', () => {
    const out = computeFunnelStats(
      [
        user({ uid: 'sent', hasSentDoc: true }),
        user({ uid: 'draftonly', hasSentDoc: false }),
        user({ uid: 'nodocs', hasSentDoc: false }),
      ],
      NOW,
    );
    expect(out.funnel.sentQuote).toBe(1);
    expect(out.conversion.activationRate).toBeCloseTo(1 / 3, 10);
  });
});

describe('neverSentQuote — no sent docs, past the grace window, excludes activated + brand-new', () => {
  const out = computeFunnelStats(
    [
      user({ uid: 'nodocs', signupAt: NOW - 5 * DAY, hasSentDoc: false }),
      user({ uid: 'draftonly', signupAt: NOW - 5 * DAY, hasSentDoc: false }),
      user({ uid: 'activated', signupAt: NOW - 5 * DAY, hasSentDoc: true }),
      user({ uid: 'brandnew', signupAt: NOW - 1 * DAY, hasSentDoc: false }),
    ],
    NOW,
  );
  const uids = out.actionable.neverSentQuote.map((r) => r.uid);

  it('includes the no-docs and draft-only users past the grace window', () => {
    expect(uids).toContain('nodocs');
    expect(uids).toContain('draftonly');
  });
  it('excludes the activated user and the brand-new signup inside the grace window', () => {
    expect(uids).not.toContain('activated');
    expect(uids).not.toContain('brandnew');
  });
});

describe('expiringTrialsInactive — trial <=3d left AND stale/absent activity', () => {
  const out = computeFunnelStats(
    [
      // trial with 2 days left, last active 10 days ago → included
      user({ uid: 'expiringStale', sub: { trialStartedAt: iso(NOW - 12 * DAY) }, lastActivityAt: NOW - 10 * DAY }),
      // same trial but active yesterday → excluded (not inactive)
      user({ uid: 'expiringActive', sub: { trialStartedAt: iso(NOW - 12 * DAY) }, lastActivityAt: NOW - 1 * DAY }),
      // free user, no subscription doc → excluded
      user({ uid: 'free', sub: null, lastActivityAt: NOW - 30 * DAY }),
    ],
    NOW,
  );
  const uids = out.actionable.expiringTrialsInactive.map((r) => r.uid);

  it('includes an expiring trial with stale activity and reports its days left', () => {
    expect(uids).toContain('expiringStale');
    const row = out.actionable.expiringTrialsInactive.find((r) => r.uid === 'expiringStale');
    expect(row?.trialDaysRemaining).toBe(2);
  });
  it('excludes an expiring trial that was active yesterday', () => {
    expect(uids).not.toContain('expiringActive');
  });
  it('excludes a free user with no subscription', () => {
    expect(uids).not.toContain('free');
  });
  it('counts all trials expiring <=3d (active + inactive), not just the nudge subset', () => {
    expect(out.expiringTrials).toBe(2);
    expect(out.actionable.expiringTrialsInactive.length).toBe(1);
  });
});

describe('division-by-zero safety — empty / no-trial inputs never produce NaN', () => {
  it('empty input yields all-zero funnel and zero rates', () => {
    const out = computeFunnelStats([], NOW);
    expect(out.funnel.signups).toBe(0);
    expect(out.conversion.trialToPaid).toBe(0);
    expect(out.conversion.activationRate).toBe(0);
    expect(Number.isNaN(out.conversion.trialToPaid)).toBe(false);
  });
  it('signups but zero trial starters → trialToPaid is 0, not NaN', () => {
    const out = computeFunnelStats([user({ uid: 'free', sub: null })], NOW);
    expect(out.funnel.startedTrial).toBe(0);
    expect(out.conversion.trialToPaid).toBe(0);
    expect(out.funnel.pctSentQuote).toBe(0);
  });
  it('safeRatio guards the raw denominator', () => {
    expect(safeRatio(3, 0)).toBe(0);
    expect(safeRatio(1, 4)).toBe(0.25);
  });
});
