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
 * (pdfGenerator), and the logo + licences (BusinessProfileScreen).
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
  { icon: 'headset', text: 'Priority support' },
];

export type PaywallPlanState =
  | { kind: 'pro' }
  | { kind: 'trial'; daysRemaining: number }
  | { kind: 'free' };

/** The line under the paywall title: where this account stands right now. */
export function paywallSubtitle(state: PaywallPlanState): string {
  switch (state.kind) {
    case 'pro':
      return 'Pro is active on this account';
    case 'free':
      return 'Your free trial has ended';
    case 'trial': {
      const d = state.daysRemaining;
      return `${d} day${d === 1 ? '' : 's'} left in your free trial`;
    }
  }
}

/**
 * The note under the subtitle for accounts that are not yet Pro. A trial is
 * Pro already, so the ask is to keep it; a free account keeps quoting and
 * Square invoicing regardless, so the note says so before listing what Pro
 * adds. Pro accounts get no note.
 */
export function paywallHeaderNote(state: PaywallPlanState): string | null {
  switch (state.kind) {
    case 'pro':
      return null;
    case 'trial':
      return "You're using Pro now. Subscribe to keep it after the trial.";
    case 'free':
      return 'Quotes and Square invoices still work on Free. Pro adds the rest.';
  }
}
