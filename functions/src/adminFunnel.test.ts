import { describe, it, expect } from 'vitest';
import {
  COHORT_WINDOW_DAYS,
  computeFunnelStats,
  isActivatingDoc,
  isRecoveredDocId,
  isTestAccount,
  maxQuoteStage,
  quoteStageOfDoc,
  quoteStageRank,
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
    ...(over.quoteStage ? { quoteStage: over.quoteStage } : {}),
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
    // A cancelled doc needs its sentAt like a draft does. Superseding an
    // option the tradie never sent must not read as a send — see the helper.
    expect(isActivatingDoc({ stage: 'cancelled' })).toBe(false);
    expect(isActivatingDoc({ stage: 'cancelled', sentAt: 123 })).toBe(true);
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
  it('cohorts are present and NaN-free even with no users at all', () => {
    const out = computeFunnelStats([], NOW);
    for (const w of COHORT_WINDOW_DAYS) {
      const c = out.cohorts[String(w)];
      expect(c.signups).toBe(0);
      expect(c.trialToPaid).toBe(0);
      expect(Number.isNaN(c.activationRate)).toBe(false);
    }
  });
});

describe('signup cohorts — each window is a true cohort, sliced by signupAt', () => {
  const billed = { isPro: true, platform: 'web', subscriptionId: 'sub_1', trialStartedAt: iso(NOW - 40 * DAY) };
  const inputs: FunnelUserInput[] = [
    // 3 days old: signed up, started a trial, sent a quote, not paying yet.
    user({ uid: 'fresh', signupAt: NOW - 3 * DAY, sub: { trialStartedAt: iso(NOW - 3 * DAY) }, hasSentDoc: true }),
    // 20 days old: trial started, never sent anything.
    user({ uid: 'mid', signupAt: NOW - 20 * DAY, sub: { trialStartedAt: iso(NOW - 20 * DAY) } }),
    // 60 days old: converted to a billed sub.
    user({ uid: 'converted', signupAt: NOW - 60 * DAY, sub: billed, hasSentDoc: true }),
    // 200 days old: ancient, all-time only.
    user({ uid: 'ancient', signupAt: NOW - 200 * DAY, sub: { trialStartedAt: iso(NOW - 200 * DAY) }, hasSentDoc: true }),
    // No signupAt at all — can't be placed in any window.
    user({ uid: 'undated', signupAt: null, sub: { trialStartedAt: iso(NOW - 5 * DAY) } }),
  ];
  const out = computeFunnelStats(inputs, NOW);

  it('7d holds only the 3-day-old signup', () => {
    expect(out.cohorts['7'].signups).toBe(1);
    expect(out.cohorts['7'].sentQuote).toBe(1);
    expect(out.cohorts['7'].paying).toBe(0);
  });
  it('28d adds the 20-day-old one', () => {
    expect(out.cohorts['28'].signups).toBe(2);
    expect(out.cohorts['28'].startedTrial).toBe(2);
    expect(out.cohorts['28'].sentQuote).toBe(1);
  });
  it('90d adds the converted 60-day-old, so the cohort has a payer', () => {
    expect(out.cohorts['90'].signups).toBe(3);
    expect(out.cohorts['90'].paying).toBe(1);
    expect(out.cohorts['90'].trialToPaid).toBeCloseTo(1 / 3, 10);
  });
  it('all-time still counts the ancient AND the undated user that no window can hold', () => {
    expect(out.funnel.signups).toBe(5);
    expect(out.cohorts['90'].signups).toBeLessThan(out.funnel.signups);
  });
  it('flags 7d as too young to judge paid conversion, 28d and 90d as mature', () => {
    expect(out.cohorts['7'].matureForPaid).toBe(false);
    expect(out.cohorts['28'].matureForPaid).toBe(true);
    expect(out.cohorts['90'].matureForPaid).toBe(true);
  });
  it('cohorts nest — every window is a subset of the next one up', () => {
    expect(out.cohorts['7'].signups).toBeLessThanOrEqual(out.cohorts['28'].signups);
    expect(out.cohorts['28'].signups).toBeLessThanOrEqual(out.cohorts['90'].signups);
  });
  it('a cohort covering everyone reproduces the all-time numbers exactly', () => {
    const dated = inputs.filter((u) => u.signupAt !== null);
    const all = computeFunnelStats(dated, NOW);
    expect(all.cohorts['90'].signups).toBe(3);
    // Widening to cover all dated users must match the headline funnel.
    const wide = computeFunnelStats(dated.filter((u) => (u.signupAt as number) >= NOW - 90 * DAY), NOW);
    expect(wide.funnel.signups).toBe(all.cohorts['90'].signups);
    expect(wide.funnel.paying).toBe(all.cohorts['90'].paying);
    expect(wide.funnel.sentQuote).toBe(all.cohorts['90'].sentQuote);
  });
});

describe('quoteStageOfDoc — which wizard screen a document is evidence of', () => {
  it('reads draftStep as the screen to RESUME at, so the step before it is done', () => {
    expect(quoteStageOfDoc({ draftStep: 'Details' })).toBe('started');
    expect(quoteStageOfDoc({ draftStep: 'CustomerDetails' })).toBe('job_details');
    expect(quoteStageOfDoc({ draftStep: 'MaterialsList' })).toBe('customer');
    expect(quoteStageOfDoc({ draftStep: 'AddMaterial' })).toBe('customer');
    expect(quoteStageOfDoc({ draftStep: 'LaborMarkup' })).toBe('materials');
    expect(quoteStageOfDoc({ draftStep: 'JobPreview' })).toBe('preview');
  });

  it('treats a sent document as the whole wizard, marker or not', () => {
    expect(quoteStageOfDoc({ stage: 'quote_sent' })).toBe('sent');
    // The draft parked at preview that later went out still reads as sent.
    expect(quoteStageOfDoc({ stage: 'draft', sentAt: NOW, draftStep: 'JobPreview' })).toBe('sent');
  });

  it('falls back to content when there is no marker, and never overstates', () => {
    expect(quoteStageOfDoc({ materials: [{ id: 'm1' }] })).toBe('materials');
    expect(quoteStageOfDoc({ total: 1200 })).toBe('materials');
    expect(quoteStageOfDoc({ customerName: 'Jane' })).toBe('customer');
    expect(quoteStageOfDoc({ customerPhone: '0400000000' })).toBe('customer');
    expect(quoteStageOfDoc({ job: { description: 'Rear fence, 18m' } })).toBe('job_details');
    // An empty saved draft proves only that a draft exists.
    expect(quoteStageOfDoc({ materials: [], total: 0, customerName: '  ' })).toBe('started');
    expect(quoteStageOfDoc(null)).toBe('none');
  });

  it('keeps the furthest of several documents', () => {
    expect(maxQuoteStage('customer', 'preview')).toBe('preview');
    expect(maxQuoteStage('preview', 'customer')).toBe('preview');
    expect(maxQuoteStage(undefined, 'started')).toBe('started');
    expect(maxQuoteStage(undefined, undefined)).toBe('none');
    expect(quoteStageRank('sent')).toBeGreaterThan(quoteStageRank('preview'));
  });
});

describe('wizard steps — where the trial→sent collapse actually happens', () => {
  const trial = (uid: string, quoteStage: any, hasSentDoc = false) =>
    user({ uid, sub: { trialStartedAt: iso(NOW - 5 * DAY) }, quoteStage, hasSentDoc });

  const out = computeFunnelStats(
    [
      trial('never_saved', 'none'),
      trial('left_at_customer', 'job_details'),
      trial('left_at_materials', 'customer'),
      trial('left_at_labour', 'materials'),
      trial('parked_at_preview', 'preview'),
      trial('sent_it', 'sent', true),
    ],
    NOW,
  );

  it('counts each screen cumulatively, so every step contains the ones below', () => {
    const f = out.funnel;
    expect(f.startedTrial).toBe(6);
    expect(f.describedJob).toBe(5);
    expect(f.addedCustomer).toBe(4);
    expect(f.addedMaterials).toBe(3);
    expect(f.reachedPreview).toBe(2);
    expect(f.sentQuote).toBe(1);
  });

  it('never lets a step exceed the one above it', () => {
    const f = out.funnel;
    const ladder = [f.startedTrial, f.describedJob, f.addedCustomer, f.addedMaterials, f.reachedPreview, f.sentQuote];
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThanOrEqual(ladder[i - 1]);
  });

  it('credits a sender the whole wizard even when their drafts say otherwise', () => {
    const f = computeFunnelStats([trial('sent_no_drafts', 'none', true)], NOW).funnel;
    expect(f.reachedPreview).toBe(1);
    expect(f.describedJob).toBe(1);
  });

  it('leaves the ladder at zero when no quote stage is known at all', () => {
    const f = computeFunnelStats([user({ uid: 'legacy', sub: { trialStartedAt: iso(NOW - 5 * DAY) } })], NOW).funnel;
    expect(f.startedTrial).toBe(1);
    expect(f.describedJob).toBe(0);
    expect(f.reachedPreview).toBe(0);
  });

  it('slices the wizard steps by cohort like every other step', () => {
    const cohort = computeFunnelStats(
      [
        trial('recent', 'preview'),
        { ...trial('old', 'preview'), signupAt: NOW - 60 * DAY },
      ],
      NOW,
    ).cohorts['28'];
    expect(cohort.signups).toBe(1);
    expect(cohort.reachedPreview).toBe(1);
  });
});
