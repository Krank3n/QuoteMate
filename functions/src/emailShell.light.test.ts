/**
 * The tradie-facing emails (welcome, trial ladder, nudges, account mail, the
 * admin notifications) all render through `wrapEmailTemplate`. As of the
 * light-shell pass they run the SAME shell as the customer-facing quote and
 * invoice templates: white card on #f7f7f7, forced-dark opt-out, full-bleed
 * on a phone.
 *
 * The old shell was a dark slate card, and its palette was inlined into every
 * one of the ~30 bodies rather than living in the wrapper. So the failure mode
 * this file exists to catch is a body that keeps (or reintroduces) a colour
 * picked for the dark card — #f8fafc text on white is invisible, #f59e0b at
 * 12px is 2.1:1. Rendering every email and scanning the output catches that
 * everywhere at once, including in emails nobody remembers to look at.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';

const captured: Array<{ subject: string; html: string }> = [];

vi.mock('node-fetch', () => ({
  default: async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body);
    captured.push({ subject: body.subject, html: body.htmlContent });
    return { ok: true, status: 200, json: async () => ({ messageId: 'x' }), text: async () => '' };
  },
}));

vi.mock('firebase-admin', () => {
  const FieldValue = { serverTimestamp: () => 'ts' };
  const docRef = {
    id: 'log1',
    get: async () => ({ exists: false, data: () => ({}) }),
    set: async () => {},
    update: async () => {},
  };
  const firestore: any = () => ({
    collection: () => ({
      add: async () => docRef,
      where: () => ({ select: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }),
      doc: () => docRef,
    }),
    doc: () => docRef,
  });
  firestore.FieldValue = FieldValue;
  return { firestore, default: { firestore } };
});

/**
 * Every colour the dark shell used. A body still carrying one of these was
 * either missed by the light pass or added against it.
 */
const RETIRED_DARK_COLOURS = [
  '#0f172a', '#1e293b', '#334155', '#475569', '#64748b', // slate surfaces + dim text
  '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9', '#f8fafc', // slate text ramp
  '#00c897', '#009868', '#5ab9ea', '#064e3b', '#7f1d1d', // accents tuned for slate
  '#78350f', '#e6b872', '#fca5a5', '#cfa153', '#a78bfa',
  '#f59e0b', '#ef4444', '#10b981', '#22c55e', // mid-tones that fail as text on white
];

type Sent = { name: string; subject: string; html: string };

const sent: Sent[] = [];

beforeAll(async () => {
  process.env.BREVO_API_KEY = 'test';
  process.env.ADMIN_EMAILS = 'admin@quotemateapp.au';
  const e = await import('./email');
  const U = 'test';

  const jobs: Array<[string, () => Promise<unknown>]> = [
    ['welcome', () => e.sendWelcomeEmail('a@b.co', 'Hansen Fencing', U)],
    ['quote-sent', () => e.sendQuoteSentEmail('a@b.co', 'Sarah Mitchell', 'QU-1042', 8118.55, U)],
    ['quote-accepted', () => e.sendQuoteAcceptedEmail('a@b.co', 'Sarah Mitchell', 'QU-1042', 8118.55, 'Keen to start', U)],
    ['quote-declined', () => e.sendQuoteDeclinedEmail('a@b.co', 'Sarah Mitchell', 'QU-1042', 8118.55, 'Went cheaper', U)],
    ['payment-failed', () => e.sendPaymentFailedEmail('a@b.co', U)],
    ['subscription-cancelled', () => e.sendSubscriptionCancelledEmail('a@b.co', 'Hansen Fencing', U)],
    ['re-engagement', () => e.sendReEngagementEmail('a@b.co', 'Hansen Fencing', 21, U)],
    ['trial-ending', () => e.sendTrialEndingEmail('a@b.co', 'Hansen Fencing', 3, U, null)],
    ['trial-ending-founding', () => e.sendTrialEndingEmail('a@b.co', 'Hansen Fencing', 3, U, { spotsLeft: 16, cap: 50 })],
    ['trial-ending-nudge', () => e.sendTrialEndingNudgeEmail('a@b.co', 'Hansen Fencing', 1, U)],
    ['trial-ended', () => e.sendTrialEndedEmail('a@b.co', 'Hansen Fencing', U, null)],
    ['trial-start-value', () => e.sendTrialStartValueEmail('a@b.co', 'Hansen Fencing', U)],
    ['trial-square-pitch', () => e.sendTrialSquarePitchEmail('a@b.co', 'Hansen Fencing', U)],
    ['trial-mid-value', () => e.sendTrialMidValueEmail('a@b.co', 'Hansen Fencing', { quotesBuilt: 6, dollarsQuoted: 48250, sent: 3, rich: true }, U)],
    ['trial-mid-value-thin', () => e.sendTrialMidValueEmail('a@b.co', 'Hansen Fencing', { quotesBuilt: 0, dollarsQuoted: 0, sent: 0, rich: false }, U)],
    ['square-idle-nudge', () => e.sendSquareIdleNudgeEmail('a@b.co', 'Hansen Fencing', U)],
    ['square-no-paylink', () => e.sendSquareNoPaylinkNudgeEmail('a@b.co', 'Hansen Fencing', U)],
    ['onboarding-tip-1', () => e.sendOnboardingTipEmail('a@b.co', 'Hansen Fencing', 1, U)],
    ['onboarding-tip-4', () => e.sendOnboardingTipEmail('a@b.co', 'Hansen Fencing', 4, U)],
    ['onboarding-tip-5', () => e.sendOnboardingTipEmail('a@b.co', 'Hansen Fencing', 5, U)],
    ['update-announcement', () => e.sendUpdateAnnouncementEmail('a@b.co', 'Hansen Fencing', U)],
    ['quote-follow-up', () => e.sendQuoteFollowUpEmail('a@b.co', 'Tom Hansen', 'Colorbond fence', 8118.55, false, U)],
    ['affiliate-invite', () => e.sendAffiliateInviteEmail('a@b.co')],
    ['material-list-error', () => e.sendMaterialListErrorEmail('a@b.co', U, 'Retile a bathroom', 'Upstream timeout')],
    ['draft-nudge', () => e.sendDraftNudgeEmail('a@b.co', 'Hansen Fencing', [
      { customerName: 'Sarah Mitchell', jobName: 'Colorbond fence', total: 8118.55, daysOld: 3 },
      { customerName: 'Dave Nguyen', jobName: 'Retaining wall', total: 12400, daysOld: 6 },
    ], 1, U)],
    ['ready-to-send-nudge', () => e.sendReadyToSendNudgeEmail('a@b.co', 'Hansen Fencing', { customerName: 'Sarah Mitchell', quoteNumber: 'QU-1042', total: 8118.55 }, 2, U)],
    ['password-reset', () => e.sendPasswordResetLinkEmail('a@b.co', 'https://example.test/reset?token=abc', U)],
    ['social-sign-in', () => e.sendSocialSignInReminderEmail('a@b.co', 'Google', U)],
    ['admin-new-user', () => e.sendNewUserNotificationEmail('a@b.co', 'ios', 'google', 'Hansen Fencing')],
    ['admin-new-pro', () => e.sendNewProSubscriptionEmail('a@b.co', U, 'ios', 'pro_monthly', 'Hansen Fencing')],
    ['admin-feedback', () => e.sendFeedbackEmail('a@b.co', U, 'quoting', 'Materials list is slow.')],
  ];

  for (const [name, run] of jobs) {
    captured.length = 0;
    await run();
    if (!captured.length) throw new Error(`${name} produced no send — fixture is wrong`);
    sent.push({ name, subject: captured[0].subject, html: captured[0].html });
  }
});

describe('tradie-facing email shell', () => {
  it('sends every email in the fixture list', () => {
    expect(sent).toHaveLength(31);
  });

  it('renders each one on the light card, not the retired slate one', () => {
    for (const { name, html } of sent) {
      expect(html, name).toContain('background-color:#f7f7f7');
      expect(html, name).toContain('background-color:#ffffff;border-radius:14px');
      expect(html, name).toContain('border-top:4px solid #059669');
    }
  });

  it('opts every one out of client-forced dark mode', () => {
    for (const { name, html } of sent) {
      expect(html, name).toContain('<meta name="color-scheme" content="light">');
      expect(html, name).toContain('<meta name="supported-color-schemes" content="light">');
    }
  });

  it('goes full-bleed on a phone, like the quote email', () => {
    for (const { name, html } of sent) {
      expect(html, name).toContain('.qm-outer-pad { padding: 0 !important; }');
      expect(html, name).toContain('.qm-card-shell {');
      expect(html, name).toContain('.qm-btn { width: 100% !important;');
    }
  });

  it('carries no colour left over from the dark shell', () => {
    const offenders: string[] = [];
    for (const { name, html } of sent) {
      for (const colour of RETIRED_DARK_COLOURS) {
        if (html.toLowerCase().includes(colour)) offenders.push(`${name}: ${colour}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('escapes the preheader instead of injecting it raw', async () => {
    const e = await import('./email');
    captured.length = 0;
    await e.sendQuoteSentEmail('a@b.co', 'Bob <b>Fencing</b>', 'QU-9', 100, 'test');
    const preheader = captured[0].html.match(/<div style="display:none;[^"]*">([\s\S]*?)<\/div>/)![1];
    expect(preheader).toContain('Bob &lt;b&gt;Fencing&lt;/b&gt;');
    expect(preheader).not.toContain('<b>');
  });

  it('prints money the way the customer-facing quote email does', () => {
    const quoteSent = sent.find(s => s.name === 'quote-sent')!;
    expect(quoteSent.html).toContain('$8,118.55');
    expect(quoteSent.html).not.toContain('$8118.55');
  });
});
