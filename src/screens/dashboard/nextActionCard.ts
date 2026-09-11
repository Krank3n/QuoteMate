/**
 * The dashboard's one state-based action card.
 *
 * nextBestAction() picks ONE primary action per tradie from durable job state;
 * this turns that key into a card the home screen can render and a route the
 * app already has. It is deliberately pure and deps-injected, like
 * doorActions.ts next door, so the mapping is unit-testable without rendering
 * the animated dashboard.
 *
 * Rules it carries:
 *   - Selling states only ever route to the paywall while the selector says
 *     `sellingAllowed`. No pricing in front of an activation state or an
 *     unpaid job.
 *   - A card that has nowhere to land renders nothing. Every route below is
 *     an existing screen, and the ones that need a job/document return null
 *     when the state can't be resolved to one.
 *   - `create_first_quote` renders nothing: the two quote doors directly
 *     below are already that action, and a card repeating them is clutter.
 *     Nor does a settled Square-connected account, whose only destination is
 *     a settings screen it has already been through.
 */

import type { DocumentStage } from '../../types/document';
import {
  docHasRealSquarePayment,
  type NextBestAction,
  type NextBestActionDoc,
  type NextBestActionKey,
} from '../../utils/nextBestAction';

/** The projection of a Document this module needs to find a landing spot. */
export interface NextActionDoc extends NextBestActionDoc {
  id: string;
  jobId?: string;
  /** Epoch ms of the last write — "most recent" is measured on this. */
  updatedAt?: number;
  /** Square link fields, read only as evidence of a connection (below). */
  squarePaymentLinkUrl?: string;
  depositPaymentLinkUrl?: string;
  activePaymentLink?: unknown;
}

/**
 * A local stand-in for the selector's `hasSquareConnection` (which is really
 * "users/{uid}/settings/squareConnection exists"). Reading the real thing
 * costs a function call, and the dashboard would pay it on every mount to
 * decide one line of copy — while a Square payment or payment link on any
 * document could only exist if Square was connected.
 *
 * Worst case is a tradie who connected Square and has not collected through
 * it yet reading "Connect Square", which lands them on the Square screen that
 * tells them the truth. Nothing routes differently on it.
 */
export function hasSquareEvidence(docs: NextActionDoc[]): boolean {
  return docs.some(
    (d) =>
      docHasRealSquarePayment(d) ||
      !!d.squarePaymentLinkUrl ||
      !!d.depositPaymentLinkUrl ||
      !!d.activePaymentLink,
  );
}

/** Which theme colour pair the card wears. Mapped to tokens by the screen. */
export type NextActionTone = 'money' | 'accent' | 'warning';

export interface NextActionRoute {
  screen: string;
  params?: Record<string, unknown>;
}

export interface NextActionCard {
  key: NextBestActionKey;
  title: string;
  subtitle: string;
  /** MaterialCommunityIcons name. */
  icon: string;
  tone: NextActionTone;
  route: NextActionRoute;
}

/** Stages where the customer owes money on the job. Mirrors nextBestAction. */
const AWAITING_PAYMENT_STAGES: ReadonlyArray<DocumentStage> = [
  'quote_accepted',
  'invoice_sent',
  'partially_paid',
];

/** Newest first, so "the draft" means the one they were last working on. */
function newest(docs: NextActionDoc[]): NextActionDoc | null {
  let best: NextActionDoc | null = null;
  for (const d of docs) {
    if (!best || (Number(d.updatedAt) || 0) > (Number(best.updatedAt) || 0)) best = d;
  }
  return best;
}

/** The job the money is sitting in, newest first. */
export function pickOwedDoc(docs: NextActionDoc[]): NextActionDoc | null {
  return newest(
    docs.filter((d) => AWAITING_PAYMENT_STAGES.includes(d.stage) && !docHasRealSquarePayment(d)),
  );
}

/** The draft waiting to go to a customer. */
export function pickDraftDoc(docs: NextActionDoc[]): NextActionDoc | null {
  return newest(docs.filter((d) => d.stage === 'draft'));
}

/** The quote already with a customer and still unanswered. */
export function pickSentQuoteDoc(docs: NextActionDoc[]): NextActionDoc | null {
  return newest(docs.filter((d) => d.stage === 'quote_sent'));
}

/** "in 2 days" / "today" — the same counting the trial banner does. */
function trialEnding(daysRemaining: number | null): string {
  if (daysRemaining === null) return 'Your trial is ending';
  return daysRemaining <= 0
    ? 'Your trial ends today'
    : `Your trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
}

/** Where the paywall ask is attributed from, for paywall_viewed. */
export const NEXT_ACTION_PAYWALL_SOURCE = 'dashboard_next_action';

export interface NextActionOptions {
  /**
   * The dashboard's single banner slot already holds a card (the draft banner
   * or the follow-up nudge). Those are more specific versions of the same
   * intent, so the next-action card stands down rather than stacking.
   */
  slotTaken?: boolean;
}

/**
 * Turn the selector's answer into the card to render, or null for "nothing
 * extra on the dashboard today".
 */
export function nextActionCard(
  action: NextBestAction,
  docs: NextActionDoc[],
  options: NextActionOptions = {},
): NextActionCard | null {
  if (action.key === 'none') return null;
  if (options.slotTaken) return null;
  // The quote doors are this action already.
  if (action.key === 'create_first_quote') return null;

  // Settled, on Free, and already collecting through Square: the only place
  // this state has to send them is the Square screen they have already set
  // up. Nothing to ask today beats a card that answers itself.
  if (action.key === 'complete_via_square' && !action.needsSquareConnect) return null;

  const card = buildCard(action, docs);
  if (!card) return null;
  // Belt and braces on the model's own rule: no subscription pricing on an
  // activation or money-moment state, whatever the key says.
  if (card.route.screen === 'Paywall' && !action.sellingAllowed) return null;
  return card;
}

/**
 * The key → card mapping on its own, with no suppression. Exported so the
 * whole table is testable (including create_first_quote, which the dashboard
 * itself leaves to the quote doors).
 */
export function buildCard(
  action: NextBestAction,
  docs: NextActionDoc[],
): NextActionCard | null {
  const paywall = (
    key: NextBestActionKey,
    title: string,
    subtitle: string,
    icon: string,
    tone: NextActionTone,
  ): NextActionCard => ({
    key,
    title,
    subtitle,
    icon,
    tone,
    route: { screen: 'Paywall', params: { source: NEXT_ACTION_PAYWALL_SOURCE } },
  });

  switch (action.key) {
    case 'take_deposit': {
      const doc = pickOwedDoc(docs);
      if (!doc?.jobId) return null;
      return {
        key: action.key,
        title: 'Money owing on a job',
        subtitle: "It's been said yes to — take the payment or send the invoice.",
        icon: 'cash-fast',
        tone: 'money',
        route: { screen: 'ViewJob', params: { jobId: doc.jobId } },
      };
    }
    case 'create_first_quote':
      return {
        key: action.key,
        title: 'Quote your first job',
        subtitle: 'Describe the job and Mate works up the materials and price.',
        icon: 'file-plus-outline',
        tone: 'accent',
        route: { screen: 'Mate', params: { source: 'next_action' } },
      };
    case 'send_first_quote': {
      const doc = pickDraftDoc(docs);
      if (!doc?.jobId) return null;
      return {
        key: action.key,
        title: 'Send your first quote',
        subtitle: 'Have a read, then get it to your customer.',
        icon: 'send-outline',
        tone: 'accent',
        // openSendDocId is the existing primitive: ViewJob opens the send
        // dialog for that doc, so the gates and money settling still run.
        route: { screen: 'ViewJob', params: { jobId: doc.jobId, openSendDocId: doc.id } },
      };
    }
    case 'follow_up': {
      const doc = pickSentQuoteDoc(docs);
      if (!doc?.jobId) return null;
      return {
        key: action.key,
        title: 'Chase up a quote',
        subtitle: 'Still no answer — a quick follow-up often gets one.',
        icon: 'bell-outline',
        tone: 'warning',
        route: { screen: 'ViewJob', params: { jobId: doc.jobId } },
      };
    }
    case 'continuity_choice':
      return paywall(
        action.key,
        trialEnding(action.trialDaysRemaining),
        'See what Pro costs and what stays free.',
        'clock-outline',
        'warning',
      );
    case 'fee_comparison':
      return paywall(
        action.key,
        'Keep more of what you collect',
        'Pro drops the fee on every Square payment.',
        'percent-outline',
        'money',
      );
    case 'keep_pro_tools':
      return paywall(
        action.key,
        'Keep the Pro tools',
        "You've been using them — Pro keeps them once the trial's up.",
        'toolbox-outline',
        'accent',
      );
    case 'complete_via_square':
      return {
        key: action.key,
        title: action.needsSquareConnect ? 'Get paid in the app' : 'Take card payments on site',
        subtitle: action.needsSquareConnect
          ? 'Connect Square and your quotes and invoices can be paid on the spot.'
          : 'Square is connected — send the pay link with your next invoice.',
        icon: 'credit-card-outline',
        tone: 'money',
        route: { screen: 'SquareIntegration' },
      };
    default:
      return null;
  }
}

export interface NextActionDeps {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  lightTap: () => void;
  track: (event: 'next_action_tapped', props: { action: string }) => void;
}

/** Tap behaviour, matching pressMateDoor/pressWizardDoor's shape. */
export function pressNextAction(card: NextActionCard, deps: NextActionDeps): void {
  deps.track('next_action_tapped', { action: card.key });
  deps.lightTap();
  deps.navigate(card.route.screen, card.route.params);
}
