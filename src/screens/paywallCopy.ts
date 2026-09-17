/**
 * Paywall copy: what Pro concretely adds, and how the header describes the
 * tradie's current plan.
 *
 * Every line here is a plain feature or fee statement. The paywall used to
 * rotate random "your competitors just upgraded" quips; those made claims we
 * cannot support and read as guilt. Free keeps unlimited quotes and Square
 * invoicing, so the copy must never suggest a free user loses those.
 *
 * Pure so it can be unit tested without the store graph.
 */
import { ACTUAL_PRICE_AUD, BillingPeriod } from '../config/pricingConfig';
import { TRIAL_DAYS, TRIAL_MS } from '../utils/trialConfig';
import {
  QM_APP_FEE_PCT_ONLINE,
  QM_APP_FEE_PCT_ONLINE_FREE,
  QM_APP_FEE_PCT_IN_PERSON,
  QM_APP_FEE_PCT_IN_PERSON_FREE,
} from '../../shared/pdf/squareFees';

export interface ProFeature {
  /** MaterialCommunityIcons name, used by the Pro-member summary. */
  icon: string;
  text: string;
}

const pct = (n: number): string => `${n}%`;

/**
 * The fee difference Pro makes on Square payments, from the fee model of
 * record so this line can never drift from what is actually deducted.
 */
export function proFeeLine(): string {
  const proPart = `${pct(QM_APP_FEE_PCT_ONLINE)} online and ${pct(QM_APP_FEE_PCT_IN_PERSON)} in person`;
  const freePart =
    QM_APP_FEE_PCT_ONLINE_FREE === QM_APP_FEE_PCT_IN_PERSON_FREE
      ? pct(QM_APP_FEE_PCT_ONLINE_FREE)
      : `${pct(QM_APP_FEE_PCT_ONLINE_FREE)} online and ${pct(QM_APP_FEE_PCT_IN_PERSON_FREE)} in person`;
  return `Lower fee on Square payments: ${proPart}, instead of ${freePart}`;
}

/**
 * What a free (post-trial) account gains by going Pro. Each entry maps to a
 * real gate: the materials + pricing pipeline (planGates), the platform fee
 * (shared/pdf/squareFees), non-Square payment methods on documents
 * (pdfGenerator), the logo + licences (BusinessProfileScreen) and the
 * accountant statement (InsightsScreen).
 */
export const PRO_FEATURES: readonly ProFeature[] = [
  {
    icon: 'clipboard-list-outline',
    text: 'Materials and pricing worked up for you from a photo, a plan or a description',
  },
  { icon: 'percent-outline', text: proFeeLine() },
  {
    icon: 'bank-outline',
    text: 'Bank transfer, PayID, BPAY and PayPal on your quotes and invoices, not just Square',
  },
  { icon: 'certificate-outline', text: 'Your logo and licences on every quote and invoice' },
  {
    icon: 'file-document-outline',
    text: 'A statement of invoices sent and payments received, emailed straight to your accountant',
  },
  { icon: 'headset', text: 'Priority support' },
];

export type PaywallPlanState =
  | { kind: 'pro' }
  /** The trial clock has not started: it starts on the first quote. */
  | { kind: 'trial_pending' }
  | { kind: 'trial'; daysRemaining: number }
  | { kind: 'free' };

/**
 * One rule for "where does this account stand", shared by the paywall, the
 * Settings row and anything else that names the plan — so a tradie never
 * reads "Free Plan" on one screen and "14 days left" on the next. The trial
 * clock starts on the first quote (trialStartedAt), not at signup.
 */
export function paywallPlanState(args: {
  isPro: boolean;
  trialExpired: boolean;
  trialStartedAt: Date | string | number | null | undefined;
  now?: number;
}): PaywallPlanState {
  if (args.isPro) return { kind: 'pro' };
  if (args.trialExpired) return { kind: 'free' };
  const startMs = args.trialStartedAt ? new Date(args.trialStartedAt).getTime() : NaN;
  if (!Number.isFinite(startMs)) return { kind: 'trial_pending' };
  const elapsed = (args.now ?? Date.now()) - startMs;
  const daysRemaining = Math.max(0, Math.ceil((TRIAL_MS - elapsed) / (24 * 60 * 60 * 1000)));
  return { kind: 'trial', daysRemaining };
}

/** The line under the paywall title: where this account stands right now. */
export function paywallSubtitle(state: PaywallPlanState): string {
  switch (state.kind) {
    case 'pro':
      return 'Pro is active on this account';
    case 'free':
      return 'Your free trial has ended';
    case 'trial_pending':
      return `Your ${TRIAL_DAYS}-day Pro trial starts with your first quote`;
    case 'trial': {
      const d = state.daysRemaining;
      return `${d} day${d === 1 ? '' : 's'} left in your free trial`;
    }
  }
}

/**
 * The note under the subtitle for accounts that are not yet Pro. When the
 * store reports no introductory offer (or this buyer has used theirs), a
 * subscription taken during the trial is billed the moment it is confirmed —
 * the note says so, because the old "subscribe to keep it after the trial"
 * read as if billing waited. When the store DOES give free days before the
 * first charge, the note says that instead, in the store's own number. A free
 * account keeps quoting and Square invoicing regardless, so the note says so
 * before listing what Pro adds. Pro accounts get no note.
 */
export function paywallHeaderNote(state: PaywallPlanState, introFreeDays: number | null = null): string | null {
  const intro = hasIntroOffer(introFreeDays);
  switch (state.kind) {
    case 'pro':
      return null;
    case 'trial_pending':
      return intro
        ? `Make a quote first and Pro is free for ${TRIAL_DAYS} days. Or start a subscription now: no charge for ${introFreeDays} days.`
        : `Make a quote first and Pro is free for ${TRIAL_DAYS} days. Subscribing now bills you today.`;
    case 'trial':
      return intro
        ? `You're on Pro for the rest of your trial. Start a subscription now and your first charge is ${introFreeDays} days away.`
        : "You're on Pro for the rest of your trial. Subscribing now bills you today, not when the trial ends.";
    case 'free':
      return 'Quotes and Square invoices still work on Free. Pro adds the rest.';
  }
}

/** A usable store introductory offer: a positive whole number of free days. */
export function hasIntroOffer(introFreeDays: number | null | undefined): introFreeDays is number {
  return typeof introFreeDays === 'number' && Number.isFinite(introFreeDays) && introFreeDays > 0;
}

/** The Settings row under "Subscription": the plan in a few words. */
export function planRowSubtitle(state: PaywallPlanState): string {
  switch (state.kind) {
    case 'pro':
      return 'Pro Member';
    case 'free':
      return 'Free plan';
    case 'trial_pending':
      return 'Pro trial starts with your first quote';
    case 'trial': {
      const d = state.daysRemaining;
      return d <= 0 ? 'Pro trial ends today' : `Pro trial · ${d} day${d === 1 ? '' : 's'} left`;
    }
  }
}

/**
 * The one button: what you get and what it costs, on the button itself. With
 * a store introductory offer the button carries the free days instead of the
 * price, because "no charge today" is the fact that moves a trial user — and
 * a Paper Button label is one line, so "14 days free, then $49/month" would
 * ellipsise the price on a 375pt phone. The price then lives in billingLine.
 */
export function proCtaLabel(priceLabel: string, period: BillingPeriod, introFreeDays: number | null = null): string {
  const unit = period === 'yearly' ? 'year' : 'month';
  return hasIntroOffer(introFreeDays)
    ? `Start Pro · ${introFreeDays} days free`
    : `Start Pro · ${priceLabel}/${unit}`;
}

/**
 * The legal line under the button. Leads with when the money moves, since
 * that is the question a trial user actually has.
 */
export function billingLine(priceLabel: string, period: BillingPeriod, introFreeDays: number | null = null): string {
  const unit = period === 'yearly' ? 'year' : 'month';
  const renewal = `Cancel anytime; renews unless cancelled 24 hours before the period ends.`;
  return hasIntroOffer(introFreeDays)
    ? `No charge for ${introFreeDays} days, then ${priceLabel}/${unit} as an auto-renewing ${period} subscription. Cancel at least 24 hours before the ${introFreeDays} days end and you pay nothing. ${renewal}`
    : `Billed today, then ${priceLabel}/${unit} as an auto-renewing ${period} subscription. ${renewal}`;
}

/**
 * Pro's price told in the tradie's own unit: minutes of their labour at the
 * rate they quote with. "$49 a month" is an abstract number; "about 27
 * minutes of your time" is a comparison they can make on the spot. The rate
 * is whatever the account quotes labour at (BusinessSettings.defaultLaborRate,
 * which onboarding stores as $85 when left blank), so the line says "at
 * $85 an hour" rather than "your rate" and never invents a figure.
 *
 * Null when the rate is unusable, so callers render nothing rather than a
 * claim built on garbage. The price defaults to the current list price of
 * record; the paywall passes the store's live price when it has one.
 */
export function proTimeLine(
  laborRatePerHour: number | null | undefined,
  monthlyPriceAud: number = ACTUAL_PRICE_AUD.monthly,
): string | null {
  const rate = Number(laborRatePerHour);
  const price = Number(monthlyPriceAud);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(price) || price <= 0) return null;
  const minutes = (price / rate) * 60;
  return `At $${formatRate(rate)} an hour, Pro costs about ${describeMinutes(minutes)} of your time a month.`;
}

function formatRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(2).replace(/\.?0+$/, '');
}

/** "27 minutes", "an hour", "1½ hours", "2 hours" — never a decimal. */
export function describeMinutes(minutes: number): string {
  if (minutes < 55) {
    const m = Math.max(1, Math.round(minutes));
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  const halves = Math.round(minutes / 30); // whole half-hours
  const hours = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  if (hours === 0) return 'half an hour';
  if (hours === 1) return half ? '1½ hours' : 'an hour';
  return half ? `${hours}½ hours` : `${hours} hours`;
}
