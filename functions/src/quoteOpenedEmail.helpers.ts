/**
 * Should a customer opening a quote EMAIL the tradie, because a push can't
 * reach them?
 *
 * 30 Sep 2026: customers open about 70% of quote emails, and hearing that is
 * the best reason a tradie has to come back to the app mid-trial. But the only
 * channel was push, and only about a third of the tradies sending quotes had
 * a push token. The rest never heard.
 *
 * Rules, in order:
 *   - only when onQuoteViewed would push (decideQuoteOpenedPush said yes),
 *     so the settled-status skip, the prefetch guard and the 24 h cooldown
 *     all apply unchanged;
 *   - never when the tradie turned quote updates off (the same toggle the
 *     push obeys);
 *   - never when the tradie has a push token: push is the channel, and a
 *     push held for quiet hours must not turn into an email instead;
 *   - once per quote (openedEmailSentAt), so a customer who keeps coming back
 *     to the page doesn't become an email a day;
 *   - only to an address that can actually receive mail.
 */
import { isUnreachableEmail } from './reEngagement.helpers';

export const QUOTE_OPENED_EMAIL_SENT_FIELD = 'openedEmailSentAt' as const;

/** Only asked once decideQuoteOpenedPush has said yes. */
export interface QuoteOpenedEmailInput {
  /** notificationPreferences.quoteUpdates === false */
  quoteUpdatesOff: boolean;
  hasPushToken: boolean;
  /** The quote's openedEmailSentAt, if any. */
  alreadyEmailed: boolean;
  tradieEmail: string | null | undefined;
}

export type QuoteOpenedEmailDecision =
  | { send: true }
  | { send: false; reason: 'prefs-off' | 'has-push' | 'already-emailed' | 'unreachable' };

export function decideQuoteOpenedEmail(input: QuoteOpenedEmailInput): QuoteOpenedEmailDecision {
  if (input.quoteUpdatesOff) return { send: false, reason: 'prefs-off' };
  if (input.hasPushToken) return { send: false, reason: 'has-push' };
  if (input.alreadyEmailed) return { send: false, reason: 'already-emailed' };
  if (isUnreachableEmail(input.tradieEmail)) return { send: false, reason: 'unreachable' };
  return { send: true };
}

export interface QuoteOpenedEmailCopy {
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  nudge: string;
  cta: string;
  pushHint: string;
}

/**
 * The words, kept pure so the copy rules are testable. HTML lives in email.ts.
 * Plain and Aussie, no "AI", nobody's gender assumed.
 */
export function quoteOpenedEmailCopy(input: {
  customerName?: string | null;
  jobName?: string | null;
  /** Already formatted, e.g. "$1,250". Omitted from the copy when empty. */
  amount?: string | null;
}): QuoteOpenedEmailCopy {
  const customer = (input.customerName || '').trim() || 'Your customer';
  const job = (input.jobName || '').trim();
  const amount = (input.amount || '').trim();
  const what = [amount ? `${amount} quote` : 'quote', job ? `for ${job}` : ''].filter(Boolean).join(' ');
  return {
    subject: `${customer} just opened your quote`,
    preheader: `${customer} is looking at your ${what} right now.`,
    heading: `${customer} opened your quote`,
    intro: `${customer} just opened your ${what}.`,
    nudge: "It's fresh in their mind, so now's a good time to follow up. A quick call or text often gets the yes.",
    cta: 'Open the app',
    pushHint: 'Want this on your phone instead? Turn on notifications in the app and we’ll ping you the moment it happens.',
  };
}
