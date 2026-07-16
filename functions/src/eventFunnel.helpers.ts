/**
 * Pure two-path event-funnel maths for the trial→monetised north star
 * (target: 20% of trials monetised, vs ~1–2% at the 2026-07 baseline).
 *
 * "Monetised" counts BOTH revenue paths:
 *   Path A (Pro subscription):  paywall_viewed → checkout_started → pro_paid
 *   Path B (Square collecting): square_connected → first_payment_collected
 * sharing the top of the funnel: signup → quote_draft → quote_sent.
 *
 * Inputs join durable Firestore state (subscription, documents, the
 * squareConnection settings doc) with event-derived booleans from
 * users/{uid}/events. Durable evidence ALWAYS wins over lossy events: a billed
 * sub counts as pro_paid even if no paywall/checkout event was ever recorded
 * (event writes are fire-and-forget and predate this instrumentation).
 *
 * Mirrors adminFunnel.helpers.ts: pure, dependency-light, injectable `now`,
 * consumed by the aggregateEventFunnel cron in adminCrm.ts.
 */
import { deriveSubFields, isBilledSub } from './subscription.helpers';
import { safeRatio } from './adminFunnel.helpers';

export type SharedStage = 'signup' | 'quote_draft' | 'quote_sent';
export type PathAStage = 'paywall_viewed' | 'checkout_started' | 'pro_paid';
export type PathBStage = 'square_connected' | 'first_payment_collected';

export const SHARED_STAGES: SharedStage[] = ['signup', 'quote_draft', 'quote_sent'];
export const PATH_A_STAGES: PathAStage[] = ['paywall_viewed', 'checkout_started', 'pro_paid'];
export const PATH_B_STAGES: PathBStage[] = ['square_connected', 'first_payment_collected'];

/** One user's joined inputs (durable state + 30-day event flags). */
export interface EventFunnelUserInput {
  uid: string;
  /** Raw subscription doc (users/{uid}/profile/subscription), or null. */
  sub: any | null;
  /** True iff the user has ≥1 document of any stage (drafts count). */
  hasQuoteDraft: boolean;
  /** True iff ≥1 document is activating (sent) — see isActivatingDoc. */
  hasSentDoc: boolean;
  /** True iff users/{uid}/settings/squareConnection exists (ever OAuth'd). */
  hasSquareConnection: boolean;
  /** True iff ≥1 document payment has method 'square' (real collected money). */
  hasSquarePayment: boolean;
  /** Event-derived (lossy): a paywall_viewed event in the window. */
  viewedPaywall: boolean;
  /** Event-derived (lossy): a checkout_started event in the window. */
  startedCheckout: boolean;
}

/**
 * THE north-star numerator: billed Pro on any platform OR at least one real
 * Square payment collected. Restored-but-unverified store subs deliberately
 * don't count here — this is the honest revenue view.
 */
export function isMonetized(input: Pick<EventFunnelUserInput, 'sub' | 'hasSquarePayment'>): boolean {
  return isBilledSub(input.sub) || input.hasSquarePayment;
}

export interface FurthestStages {
  shared: SharedStage;
  /** Furthest Path A stage, or null if the user never entered the path. */
  pathA: PathAStage | null;
  /** Furthest Path B stage, or null if the user never entered the path. */
  pathB: PathBStage | null;
}

/**
 * Classify how far a user got on each path. Later stages imply earlier ones
 * (cumulative), and durable evidence never regresses below what events say:
 * a billed sub is pro_paid regardless of recorded events; a Square payment is
 * first_payment_collected even if the connection doc was later deleted.
 */
export function furthestStage(input: EventFunnelUserInput): FurthestStages {
  const shared: SharedStage = input.hasSentDoc
    ? 'quote_sent'
    : input.hasQuoteDraft
      ? 'quote_draft'
      : 'signup';

  const pathA: PathAStage | null = isBilledSub(input.sub)
    ? 'pro_paid'
    : input.startedCheckout
      ? 'checkout_started'
      : input.viewedPaywall
        ? 'paywall_viewed'
        : null;

  const pathB: PathBStage | null = input.hasSquarePayment
    ? 'first_payment_collected'
    : input.hasSquareConnection
      ? 'square_connected'
      : null;

  return { shared, pathA, pathB };
}

export interface EventFunnelPayload {
  /** Cumulative reach counts — every user at-or-past each stage. */
  shared: { signups: number; quoteDraft: number; quoteSent: number };
  pathA: {
    paywallViewed: number;
    checkoutStarted: number;
    proPaid: number;
    /** Step conversion, each as a fraction of the previous stage. */
    pctCheckoutStarted: number;
    pctProPaid: number;
  };
  pathB: {
    squareConnected: number;
    firstPaymentCollected: number;
    pctFirstPayment: number;
  };
  monetized: {
    count: number;
    viaPro: number;
    viaSquare: number;
    viaBoth: number;
  };
  conversion: {
    /** THE headline: monetised (either path) / started trial. Target 0.20. */
    trialToMonetized: number;
    /** quote_sent / signups. */
    activationRate: number;
  };
  trialStarted: number;
  /**
   * Per-user furthest-stage histograms — where people STALL. pathA/pathB
   * count only users who entered the path; shared counts everyone.
   */
  histogram: {
    shared: Record<SharedStage, number>;
    pathA: Record<PathAStage, number>;
    pathB: Record<PathBStage, number>;
  };
  asOf: number;
  /** Days of event history joined in (durable state has no window). */
  eventWindowDays: number;
  cached: boolean;
}

/** Roll the joined per-user inputs up into the admin payload. */
export function rollupEventFunnel(
  inputs: EventFunnelUserInput[],
  now: number,
  eventWindowDays: number
): EventFunnelPayload {
  const histogram = {
    shared: { signup: 0, quote_draft: 0, quote_sent: 0 } as Record<SharedStage, number>,
    pathA: { paywall_viewed: 0, checkout_started: 0, pro_paid: 0 } as Record<PathAStage, number>,
    pathB: { square_connected: 0, first_payment_collected: 0 } as Record<PathBStage, number>,
  };

  let quoteDraft = 0;
  let quoteSent = 0;
  let paywallViewed = 0;
  let checkoutStarted = 0;
  let proPaid = 0;
  let squareConnected = 0;
  let firstPaymentCollected = 0;
  let viaPro = 0;
  let viaSquare = 0;
  let viaBoth = 0;
  let trialStarted = 0;

  for (const input of inputs) {
    const stages = furthestStage(input);
    histogram.shared[stages.shared]++;
    if (stages.pathA) histogram.pathA[stages.pathA]++;
    if (stages.pathB) histogram.pathB[stages.pathB]++;

    // Cumulative reach: at-or-past each stage.
    if (stages.shared !== 'signup') quoteDraft++;
    if (stages.shared === 'quote_sent') quoteSent++;

    if (stages.pathA) paywallViewed++;
    if (stages.pathA === 'checkout_started' || stages.pathA === 'pro_paid') checkoutStarted++;
    if (stages.pathA === 'pro_paid') proPaid++;

    if (stages.pathB) squareConnected++;
    if (stages.pathB === 'first_payment_collected') firstPaymentCollected++;

    const pro = isBilledSub(input.sub);
    if (pro) viaPro++;
    if (input.hasSquarePayment) viaSquare++;
    if (pro && input.hasSquarePayment) viaBoth++;

    if (deriveSubFields(input.sub, now).trialStartedAt !== null) trialStarted++;
  }

  const monetizedCount = viaPro + viaSquare - viaBoth;

  return {
    shared: { signups: inputs.length, quoteDraft, quoteSent },
    pathA: {
      paywallViewed,
      checkoutStarted,
      proPaid,
      pctCheckoutStarted: safeRatio(checkoutStarted, paywallViewed),
      pctProPaid: safeRatio(proPaid, checkoutStarted),
    },
    pathB: {
      squareConnected,
      firstPaymentCollected,
      pctFirstPayment: safeRatio(firstPaymentCollected, squareConnected),
    },
    monetized: { count: monetizedCount, viaPro, viaSquare, viaBoth },
    conversion: {
      trialToMonetized: safeRatio(monetizedCount, trialStarted),
      activationRate: safeRatio(quoteSent, inputs.length),
    },
    trialStarted,
    histogram,
    asOf: now,
    eventWindowDays,
    cached: false,
  };
}

/**
 * Fold one raw event doc into a user's event flags. Kept here (pure) so the
 * cron's bucketing de-dups repeated events per uid without extra logic.
 */
export interface UserEventFlags {
  viewedPaywall: boolean;
  startedCheckout: boolean;
}

export function foldEvent(flags: UserEventFlags | undefined, event: unknown): UserEventFlags {
  const next: UserEventFlags = flags ?? { viewedPaywall: false, startedCheckout: false };
  if (event === 'paywall_viewed') next.viewedPaywall = true;
  if (event === 'checkout_started') next.startedCheckout = true;
  return next;
}

/**
 * True iff a document records at least one REAL Square payment (webhook-written
 * payments[] entry with method 'square'). Manual "record payment" entries
 * (cash/bank) don't monetise QuoteMate and must not count.
 */
export function docHasSquarePayment(doc: { payments?: unknown } | null | undefined): boolean {
  const payments = doc?.payments;
  if (!Array.isArray(payments)) return false;
  return payments.some(
    (p: any) => p && (p.method === 'square' || typeof p.squarePaymentId === 'string')
  );
}
