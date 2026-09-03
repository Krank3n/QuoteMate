/**
 * Pure two-path event-funnel maths for the trial→monetised north star
 * (target: 20% of trials monetised, vs ~1–2% at the 2026-07 baseline).
 *
 * "Monetised" counts BOTH revenue paths:
 *   Path A (Pro subscription):  paywall_viewed → checkout_started → pro_paid
 *   Path B (Square collecting): square_connected → first_payment_collected
 * sharing the top of the funnel: signup → quote_draft → quote_sent, which
 * then runs on into what the CUSTOMER did with the quote:
 *   quote_sent → customer_viewed → quote_accepted
 * Sending is the activation event (2026-07 audit), but the stretch between
 * a send and a paywall view was dark: nothing recorded whether the customer
 * opened the quote, said yes, or whether the tradie ever came back to see
 * it. `monetizedByStage` is the read on whether a customer's response
 * predicts paying, and `returns` is the read on whether anyone comes back.
 *
 * Inputs join durable Firestore state (subscription, documents, the legacy
 * quotes' view stamps, the squareConnection settings doc) with event-derived
 * booleans from users/{uid}/events. Durable evidence ALWAYS wins over lossy events: a billed
 * sub counts as pro_paid even if no paywall/checkout event was ever recorded
 * (event writes are fire-and-forget and predate this instrumentation).
 *
 * The send-flow sub-funnel at the bottom of this file zooms into the single
 * darkest stretch: what happens between opening the send sheet and a quote
 * actually going out. Same rules apply there.
 *
 * Mirrors adminFunnel.helpers.ts: pure, dependency-light, injectable `now`,
 * consumed by the aggregateEventFunnel cron in adminCrm.ts.
 */
import { deriveSubFields, isBilledSub } from './subscription.helpers';
import { safeRatio } from './adminFunnel.helpers';

export type SharedStage =
  | 'signup'
  | 'quote_draft'
  | 'quote_sent'
  | 'customer_viewed'
  | 'quote_accepted';
export type PathAStage = 'paywall_viewed' | 'checkout_started' | 'pro_paid';
export type PathBStage = 'square_connected' | 'first_payment_collected';

export const SHARED_STAGES: SharedStage[] = [
  'signup',
  'quote_draft',
  'quote_sent',
  'customer_viewed',
  'quote_accepted',
];

/** Position on the shared ladder, so "at or past" comparisons read as maths. */
export function sharedStageRank(stage: SharedStage): number {
  return SHARED_STAGES.indexOf(stage);
}

/**
 * An app open at least this many hours after the previous one is a RETURN
 * VISIT — a later sitting — rather than the same session resumed after a
 * phone call or a switch to the calculator. Half a day separates "came back
 * tomorrow" from "came back in a minute" without depending on time zones or
 * calendar-day boundaries.
 */
export const RETURN_GAP_HOURS = 12;
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
  /** True iff a customer opened ≥1 quote's acceptance link — see isViewedDoc. */
  hasViewedDoc: boolean;
  /**
   * True iff ≥1 quote was accepted — by the customer on the link or by the
   * tradie marking it in the app — see isAcceptedDoc. Either way the job was
   * won, which is the first moment the app has visibly earned its keep.
   */
  hasAcceptedDoc: boolean;
  /** True iff users/{uid}/settings/squareConnection exists (ever OAuth'd). */
  hasSquareConnection: boolean;
  /** True iff ≥1 document payment has method 'square' (real collected money). */
  hasSquarePayment: boolean;
  /** Event-derived (lossy): a paywall_viewed event in the window. */
  viewedPaywall: boolean;
  /** Event-derived (lossy): a checkout_started event in the window. */
  startedCheckout: boolean;
  /**
   * Send-flow event flags. Undefined when the user recorded no events in the
   * window at all — which is the normal state for anyone who last used the app
   * before the send instrumentation shipped, NOT evidence they skipped a step.
   */
  send?: SendFlowFlags;
  /**
   * app_opened event flags, same window and same caveat as `send`: undefined
   * means no events at all, not evidence the app was never opened.
   */
  opens?: AppOpenFlags;
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
  // Later stages imply earlier ones: an accepted quote counts as viewed even
  // when the tradie marked it accepted by hand and no view was ever stamped.
  const shared: SharedStage = input.hasAcceptedDoc
    ? 'quote_accepted'
    : input.hasViewedDoc
      ? 'customer_viewed'
      : input.hasSentDoc
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
  shared: {
    signups: number;
    quoteDraft: number;
    quoteSent: number;
    customerViewed: number;
    quoteAccepted: number;
  };
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
    /** customer_viewed / quote_sent — did the quote get in front of anyone. */
    sentToViewed: number;
    /** quote_accepted / quote_sent — did the tradie win the job. */
    sentToAccepted: number;
  };
  trialStarted: number;
  /**
   * Monetised users bucketed by their FURTHEST shared stage. Read against
   * histogram.shared (the same buckets, all users) for the rate: if
   * quote_accepted converts and quote_sent doesn't, the lever is getting the
   * quote answered, not the paywall.
   */
  monetizedByStage: Record<SharedStage, number>;
  /**
   * Return visits, from app_opened events in the window. `opened` is anyone
   * who opened the app at all; `returnedLater` came back after a gap of at
   * least RETURN_GAP_HOURS; `viaPush` opened from a notification tap at
   * least once. Before the app_opened instrumentation shipped every user
   * reads as zero here — that is missing data, not a retention verdict.
   */
  returns: {
    opened: number;
    returnedLater: number;
    viaPush: number;
    /** Users brought back by each push type — which notifications actually work. */
    byPushType: Record<string, number>;
  };
  /**
   * What the customer did with the quote, per sender and per quote — the
   * exclusive companion to the cumulative ladder above. See rollupOutcomes.
   */
  outcomes: OutcomeBreakdown;
  /**
   * Per-user furthest-stage histograms — where people STALL. pathA/pathB
   * count only users who entered the path; shared counts everyone.
   */
  histogram: {
    shared: Record<SharedStage, number>;
    pathA: Record<PathAStage, number>;
    pathB: Record<PathBStage, number>;
  };
  /** Zoom into the quote_sent step — see the send-flow section below. */
  sendFlow: SendFlowBreakdown;
  asOf: number;
  /** Days of event history joined in (durable state has no window). */
  eventWindowDays: number;
  cached: boolean;
}

/** Roll the joined per-user inputs up into the admin payload. */
export function rollupEventFunnel(
  inputs: EventFunnelUserInput[],
  now: number,
  eventWindowDays: number,
  outcomeDocs: OutcomeDocInput[] = []
): EventFunnelPayload {
  const emptyShared = (): Record<SharedStage, number> => ({
    signup: 0,
    quote_draft: 0,
    quote_sent: 0,
    customer_viewed: 0,
    quote_accepted: 0,
  });
  const histogram = {
    shared: emptyShared(),
    pathA: { paywall_viewed: 0, checkout_started: 0, pro_paid: 0 } as Record<PathAStage, number>,
    pathB: { square_connected: 0, first_payment_collected: 0 } as Record<PathBStage, number>,
  };

  const monetizedByStage = emptyShared();
  const returns = { opened: 0, returnedLater: 0, viaPush: 0, byPushType: {} as Record<string, number> };

  let quoteDraft = 0;
  let quoteSent = 0;
  let customerViewed = 0;
  let quoteAccepted = 0;
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
    const rank = sharedStageRank(stages.shared);
    if (rank >= sharedStageRank('quote_draft')) quoteDraft++;
    if (rank >= sharedStageRank('quote_sent')) quoteSent++;
    if (rank >= sharedStageRank('customer_viewed')) customerViewed++;
    if (rank >= sharedStageRank('quote_accepted')) quoteAccepted++;
    if (isMonetized(input)) monetizedByStage[stages.shared]++;

    if (input.opens?.openedApp) returns.opened++;
    if (input.opens?.returnedLater) returns.returnedLater++;
    if (input.opens?.returnedViaPush) returns.viaPush++;
    for (const type of input.opens?.pushTypes ?? []) {
      returns.byPushType[type] = (returns.byPushType[type] ?? 0) + 1;
    }

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
    shared: { signups: inputs.length, quoteDraft, quoteSent, customerViewed, quoteAccepted },
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
      sentToViewed: safeRatio(customerViewed, quoteSent),
      sentToAccepted: safeRatio(quoteAccepted, quoteSent),
    },
    trialStarted,
    monetizedByStage,
    returns,
    outcomes: rollupOutcomes(outcomeDocs, inputs),
    histogram,
    sendFlow: rollupSendFlow(inputs),
    asOf: now,
    eventWindowDays,
    cached: false,
  };
}

/**
 * Fold one raw event doc into a user's event flags. Kept here (pure) so the
 * cron's bucketing de-dups repeated events per uid without extra logic.
 *
 * `props` is the event's payload object (users/{uid}/events/{id}.props). Most
 * events don't need it; the send-flow ones carry the method, the self-send flag
 * and the email-generation wait we want to measure.
 */
/** One user's app_opened flags, de-duped across repeated events. */
export interface AppOpenFlags {
  /** At least one app_opened in the window. */
  openedApp: boolean;
  /** An open at least RETURN_GAP_HOURS after the previous one — a later sitting. */
  returnedLater: boolean;
  /** At least one open attributed to a notification tap (source 'push'). */
  returnedViaPush: boolean;
  /** Which pushes brought this user back — one entry per push_type seen. */
  pushTypes: string[];
}

export function emptyAppOpenFlags(): AppOpenFlags {
  return { openedApp: false, returnedLater: false, returnedViaPush: false, pushTypes: [] };
}

/**
 * Fold one app_opened event into a user's flags, in place. The client sends
 * `source` (cold | foreground | push) and `hours_since_last_open` (null on
 * the first open a device has ever seen); unusable props degrade to "opened,
 * details unknown", same as the send-flow folds.
 */
export function foldAppOpenEvent(flags: AppOpenFlags, event: unknown, props?: unknown): void {
  if (event !== 'app_opened') return;
  const p = (props && typeof props === 'object' ? props : {}) as Record<string, unknown>;
  flags.openedApp = true;
  const gap = typeof p.hours_since_last_open === 'number' ? p.hours_since_last_open : NaN;
  if (Number.isFinite(gap) && gap >= RETURN_GAP_HOURS) flags.returnedLater = true;
  if (p.source === 'push') {
    flags.returnedViaPush = true;
    const type = typeof p.push_type === 'string' ? p.push_type.trim() : '';
    if (type && !flags.pushTypes.includes(type)) flags.pushTypes.push(type);
  }
}

export interface UserEventFlags extends SendFlowFlags, AppOpenFlags {
  viewedPaywall: boolean;
  startedCheckout: boolean;
}

function emptyEventFlags(): UserEventFlags {
  return {
    viewedPaywall: false,
    startedCheckout: false,
    ...emptySendFlowFlags(),
    ...emptyAppOpenFlags(),
  };
}

export function foldEvent(
  flags: UserEventFlags | undefined,
  event: unknown,
  props?: unknown
): UserEventFlags {
  const next: UserEventFlags = flags ?? emptyEventFlags();
  if (event === 'paywall_viewed') next.viewedPaywall = true;
  if (event === 'checkout_started') next.startedCheckout = true;
  foldSendEvent(next, event, props);
  foldAppOpenEvent(next, event, props);
  return next;
}

/**
 * True iff a customer opened this quote's acceptance link. The public quote
 * page (getQuoteForAcceptance in index.ts) stamps firstViewedAt /
 * lastViewedAt / viewCount on the legacy users/{uid}/quotes doc, and the
 * documents mirror does NOT carry those fields across — so the cron runs
 * this over BOTH collections, and a documents twin without the stamps is
 * not evidence that nobody looked.
 */
export function isViewedDoc(
  doc: { firstViewedAt?: unknown; lastViewedAt?: unknown; viewCount?: unknown } | null | undefined
): boolean {
  if (!doc) return false;
  if (doc.firstViewedAt != null || doc.lastViewedAt != null) return true;
  return typeof doc.viewCount === 'number' && doc.viewCount > 0;
}

/**
 * True iff the quote was accepted — the job was won. That is either the
 * customer tapping Accept on the link (the acceptance handler writes
 * respondedAt + status 'accepted', which the mirror projects to stage
 * quote_accepted and setDocumentStage stamps as acceptedAt) or the tradie
 * marking it accepted in the app (same stage transition). A quote converted
 * to an invoice was won too, even if it skipped the accepted stage.
 *
 * Rejected and cancelled never count, whatever else is stamped, and an
 * invoice-only document (no quote step) is not an acceptance.
 */
export function isAcceptedDoc(
  doc:
    | {
        stage?: unknown;
        acceptedAt?: unknown;
        invoicedAt?: unknown;
        respondedAt?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!doc) return false;
  const stage = typeof doc.stage === 'string' ? doc.stage : '';
  if (stage === 'quote_rejected' || stage === 'cancelled') return false;
  if (stage === 'quote_accepted') return true;
  if (doc.acceptedAt != null || doc.invoicedAt != null) return true;
  // Legacy accept: respondedAt on a doc that isn't rejected. The mirror maps
  // the accompanying status forward (accepted → quote_accepted, then on to
  // invoice_sent / paid as the job progresses), so the stage alone can't be
  // relied on to still say "accepted" by the time the cron reads it.
  return doc.respondedAt != null;
}

/**
 * Milliseconds from any of the timestamp shapes the two collections hold:
 * a number (documents), a Firestore Timestamp (quotes' server stamps), a
 * Date, or an ISO string (older client writes). Null for anything else.
 */
export function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

// ===========================================================================
// CUSTOMER OUTCOMES — what happened to each sent quote
// ===========================================================================
//
// The shared ladder above is cumulative (an acceptance implies a view), which
// is right for reach but hides two things a reader wants: how many quotes a
// customer ACTUALLY opened, and how each sender's story ended. This section
// is exclusive — every sender lands in exactly one bucket, by the best thing
// any customer did with any of their quotes — and per quote it measures how
// long the customer took and which channel got the quote opened at all.

/** A sender's best outcome, worst to best. Rejected outranks silence: the customer engaged and answered. */
export type OutcomeBucket = 'never_opened' | 'opened_no_answer' | 'rejected' | 'accepted';

export const OUTCOME_BUCKETS: OutcomeBucket[] = [
  'never_opened',
  'opened_no_answer',
  'rejected',
  'accepted',
];

/** One SENT quote's outcome facts, joined across its documents twin and legacy quote. */
export interface OutcomeDocInput {
  uid: string;
  /** When it went out (documents.sentAt), ms. */
  sentAt: number | null;
  /** First customer open of the acceptance link (legacy quote's firstViewedAt), ms. */
  firstViewedAt: number | null;
  /** When it was accepted (acceptedAt, or the customer's respondedAt on an accept), ms. */
  acceptedAt: number | null;
  accepted: boolean;
  rejected: boolean;
  /** email | sms | share | export_pdf | manual, or null when the first send predates the field. */
  sendMethod: string | null;
  /**
   * An acceptance link was minted for it (email and SMS sends carry one; a
   * shared or exported PDF and a hand-marked send do not). Only linked quotes
   * can ever be opened, so the open rate is measured against these.
   */
  withLink: boolean;
  /**
   * The customer opened the QUOTE EMAIL (the 1x1 tracking pixel loaded at
   * least once — the trackEmailOpen handler stamps emailFirstOpenedAt on the
   * legacy quote). Sits between "sent" and "link opened" on the ladder and
   * answers "did anyone even open this quote?" — the panel is silent about
   * SMS or share sends, which have no pixel.
   */
  emailOpened: boolean;
}

export interface OutcomeBreakdown {
  /**
   * Users at or past quote_sent on the shared ladder — the same population
   * as shared.quoteSent, so the two panels agree. Every bucket sums to this.
   */
  senders: number;
  /** Senders by best outcome — exclusive. */
  buckets: Record<OutcomeBucket, number>;
  /** Of each bucket, how many are monetised (billed Pro or collecting via Square). */
  monetized: Record<OutcomeBucket, number>;
  /** Raw, not implied: senders with ≥1 quote a customer actually opened. */
  openedLink: number;
  /**
   * Quotes, not users.
   *  - `withLink` had an acceptance link to open (email/SMS sends).
   *  - `emailOpened` is the raw email-open count (the pixel loaded at least
   *    once). Sits between `sent` and `opened` on the ladder — the reader
   *    can now tell "email never opened" from "opened but the link ignored".
   *  - `opened` is the raw acceptance-link-open count.
   */
  quotes: {
    sent: number;
    withLink: number;
    emailOpened: number;
    opened: number;
    accepted: number;
    rejected: number;
  };
  /** Hours from send to the customer's first open, per quote that was opened. One decimal. */
  hoursToOpen: WaitSummary;
  /** Hours from send to acceptance, per accepted quote with a known accept time. One decimal. */
  hoursToAccept: WaitSummary;
  /**
   * Per send channel: quotes sent, how many carried a link, how many had
   * their email opened, and how many the customer link-opened / accepted.
   */
  bySendMethod: Record<
    string,
    { sent: number; withLink: number; emailOpened: number; opened: number; accepted: number }
  >;
}

const HOUR_MS = 60 * 60 * 1000;

function emptyBuckets(): Record<OutcomeBucket, number> {
  return { never_opened: 0, opened_no_answer: 0, rejected: 0, accepted: 0 };
}

/** The best outcome a sender saw, over all their sent quotes. */
export function bestOutcome(docs: Pick<OutcomeDocInput, 'accepted' | 'rejected' | 'firstViewedAt'>[]): OutcomeBucket {
  let best = 0;
  for (const d of docs) {
    const rank = d.accepted ? 3 : d.rejected ? 2 : d.firstViewedAt !== null ? 1 : 0;
    if (rank > best) best = rank;
  }
  return OUTCOME_BUCKETS[best];
}

/**
 * Roll sent quotes up into the outcome breakdown. `inputs` supplies the sender
 * population — everyone at or past quote_sent on the ladder, which includes a
 * user whose only evidence of sending is a customer having opened or accepted
 * a legacy quote with no documents twin — and who is monetised. Docs whose uid
 * is not in it (test accounts, deleted users) are ignored. A sender's bucket
 * is the best of what their quote rows say and what their user-level flags
 * say, so those twin-less legacy quotes still land where they belong rather
 * than in never_opened; a sender with no rows and no flags (an invoice-only
 * sender) is never_opened. The buckets always sum to senders.
 */
export function rollupOutcomes(
  docs: OutcomeDocInput[],
  inputs: EventFunnelUserInput[]
): OutcomeBreakdown {
  const sentRank = sharedStageRank('quote_sent');
  const senders = inputs.filter((u) => sharedStageRank(furthestStage(u).shared) >= sentRank);
  const senderIds = new Set(senders.map((u) => u.uid));
  const byUid = new Map<string, OutcomeDocInput[]>();
  for (const d of docs) {
    if (!senderIds.has(d.uid)) continue;
    const list = byUid.get(d.uid);
    if (list) list.push(d);
    else byUid.set(d.uid, [d]);
  }

  const buckets = emptyBuckets();
  const monetized = emptyBuckets();
  let openedLink = 0;
  for (const u of senders) {
    const mine = byUid.get(u.uid) ?? [];
    const fromRows = bestOutcome(mine);
    const fromFlags: OutcomeBucket = u.hasAcceptedDoc
      ? 'accepted'
      : u.hasViewedDoc
        ? 'opened_no_answer'
        : 'never_opened';
    const bucket =
      OUTCOME_BUCKETS.indexOf(fromFlags) > OUTCOME_BUCKETS.indexOf(fromRows) ? fromFlags : fromRows;
    buckets[bucket]++;
    if (isMonetized(u)) monetized[bucket]++;
    if (u.hasViewedDoc || mine.some((d) => d.firstViewedAt !== null)) openedLink++;
  }

  const quotes = { sent: 0, withLink: 0, emailOpened: 0, opened: 0, accepted: 0, rejected: 0 };
  const toOpen: number[] = [];
  const toAccept: number[] = [];
  const bySendMethod: Record<
    string,
    { sent: number; withLink: number; emailOpened: number; opened: number; accepted: number }
  > = {};
  for (const d of docs) {
    if (!senderIds.has(d.uid)) continue;
    quotes.sent++;
    const opened = d.firstViewedAt !== null;
    // An open (of the link) or an email-open both prove a link existed even
    // when the token fields were later lost.
    const withLink = d.withLink || opened || d.emailOpened;
    if (withLink) quotes.withLink++;
    if (d.emailOpened) quotes.emailOpened++;
    if (opened) quotes.opened++;
    if (d.accepted) quotes.accepted++;
    if (d.rejected) quotes.rejected++;

    const method = d.sendMethod || 'unknown';
    const row =
      bySendMethod[method] ??
      (bySendMethod[method] = { sent: 0, withLink: 0, emailOpened: 0, opened: 0, accepted: 0 });
    row.sent++;
    if (withLink) row.withLink++;
    if (d.emailOpened) row.emailOpened++;
    if (opened) row.opened++;
    if (d.accepted) row.accepted++;

    // A view or accept stamped before the send is clock skew or a re-send;
    // summariseWaits drops negatives, so hand them through unfiltered.
    if (d.sentAt !== null && d.firstViewedAt !== null) toOpen.push((d.firstViewedAt - d.sentAt) / HOUR_MS);
    if (d.sentAt !== null && d.accepted && d.acceptedAt !== null) {
      toAccept.push((d.acceptedAt - d.sentAt) / HOUR_MS);
    }
  }

  return {
    senders: senders.length,
    buckets,
    monetized,
    openedLink,
    quotes,
    hoursToOpen: summariseWaits(toOpen, 1),
    hoursToAccept: summariseWaits(toAccept, 1),
    bySendMethod,
  };
}

/**
 * True iff one payments[] entry came from Square rather than a manual "record
 * payment" tap. The webhook writes both `method: 'square'` and a
 * `squarePaymentId` (see documentHandlers.ts), so either alone is sufficient.
 */
function isSquarePayment(p: any): boolean {
  return !!p && (p.method === 'square' || typeof p.squarePaymentId === 'string');
}

/**
 * True iff a document records at least one REAL Square payment (webhook-written
 * payments[] entry with method 'square'). Manual "record payment" entries
 * (cash/bank) don't monetise QuoteMate and must not count.
 */
export function docHasSquarePayment(doc: { payments?: unknown } | null | undefined): boolean {
  const payments = doc?.payments;
  if (!Array.isArray(payments)) return false;
  return payments.some(isSquarePayment);
}

/**
 * Dollars on a document that actually flowed through Square — the only slice
 * QuoteMate earns a platform fee on. Deliberately NOT `paidTotal`: a doc can
 * mix a Square deposit with a manually-recorded bank-transfer balance, and
 * only the former monetises.
 */
export function sumSquarePayments(doc: { payments?: unknown } | null | undefined): number {
  const payments = doc?.payments;
  if (!Array.isArray(payments)) return 0;
  return payments.reduce(
    (acc: number, p: any) => (isSquarePayment(p) ? acc + (Number(p.amount) || 0) : acc),
    0
  );
}

// ===========================================================================
// SEND-FLOW SUB-FUNNEL — the dark stretch inside `quote_sent`
// ===========================================================================
//
// The 2026-07-29 analytics run found the business's biggest leak sits at the
// send moment: 138 tradies have built a quote, 25 ever sent one to a real
// customer, and 4 of those 25 pay. Until now the only instrumentation in that
// stretch was the free-tier delivery gate (send_gate_*), which fires for a
// handful of users and says nothing about everyone else — so every claim about
// send drop-off was INFERRED from document stage rather than observed.
//
// The client now emits five events across the flow:
//   send_sheet_opened    → the send sheet is up
//   send_method_chosen   → picked email / sms / share / export_pdf
//   email_preview_opened → the generated email body is on screen (+ wait_ms)
//   email_preview_abandoned → backed out of the preview
//   quote_send_succeeded → it actually went out
//
// Two rules shape the maths here:
//
//  1. DURABLE EVIDENCE WINS, same as the rest of this file. A document that
//     left draft stage proves a send even when quote_send_succeeded was never
//     written — event writes are fire-and-forget and every send before this
//     instrumentation has no event at all. `durableOnlySends` reports how many
//     sends rest on document stage alone, so a reader can see how much of the
//     picture is still inference rather than observation.
//
//  2. THE FLOW BRANCHES. Only the email method reaches a preview; SMS, share
//     and export_pdf go straight out. So the preview numbers live in their own
//     `email` block measured against email-method pickers, and are deliberately
//     NOT treated as a rung every sender must have climbed. The stall histogram
//     still orders the preview above method-chosen, because for someone who
//     never sent, reaching the preview genuinely is further along.

export type SendMethod = 'email' | 'sms' | 'share' | 'export_pdf';

export const SEND_METHODS: SendMethod[] = ['email', 'sms', 'share', 'export_pdf'];

/** The furthest point of the send flow a user reached, worst to best. */
export type SendStage = 'send_sheet_opened' | 'method_chosen' | 'email_preview_opened' | 'quote_sent';

export const SEND_STAGES: SendStage[] = [
  'send_sheet_opened',
  'method_chosen',
  'email_preview_opened',
  'quote_sent',
];

/** One user's send-flow event flags, de-duped across repeated events. */
export interface SendFlowFlags {
  openedSendSheet: boolean;
  choseSendMethod: boolean;
  openedEmailPreview: boolean;
  abandonedEmailPreview: boolean;
  /** Lossy: durable document stage is the stronger signal — see rule 1. */
  sendSucceeded: boolean;
  /** At least one send addressed to the tradie themselves, not a customer. */
  sentToSelf: boolean;
  /** Methods picked at least once. A tradie who tried two lands in both. */
  methods: SendMethod[];
  /** One entry per email_preview_opened — how long they waited, in ms. */
  previewWaitMs: number[];
}

export function emptySendFlowFlags(): SendFlowFlags {
  return {
    openedSendSheet: false,
    choseSendMethod: false,
    openedEmailPreview: false,
    abandonedEmailPreview: false,
    sendSucceeded: false,
    sentToSelf: false,
    methods: [],
    previewWaitMs: [],
  };
}

/** Narrow an untrusted props.method to a known send method, else null. */
export function parseSendMethod(value: unknown): SendMethod | null {
  return SEND_METHODS.includes(value as SendMethod) ? (value as SendMethod) : null;
}

/**
 * Fold one send-flow event into a user's flags, in place. Unknown events are
 * ignored, and unusable props degrade to "the step happened, details unknown"
 * rather than throwing — these are best-effort client writes.
 */
export function foldSendEvent(flags: SendFlowFlags, event: unknown, props?: unknown): void {
  const p = (props && typeof props === 'object' ? props : {}) as Record<string, unknown>;

  if (event === 'send_sheet_opened') {
    flags.openedSendSheet = true;
  } else if (event === 'send_method_chosen') {
    flags.choseSendMethod = true;
    const method = parseSendMethod(p.method);
    if (method && !flags.methods.includes(method)) flags.methods.push(method);
  } else if (event === 'email_preview_opened') {
    flags.openedEmailPreview = true;
    // Negative or non-finite waits are clock skew, not measurements.
    const wait = typeof p.wait_ms === 'number' ? p.wait_ms : NaN;
    if (Number.isFinite(wait) && wait >= 0) flags.previewWaitMs.push(wait);
  } else if (event === 'email_preview_abandoned') {
    flags.abandonedEmailPreview = true;
  } else if (event === 'quote_send_succeeded') {
    flags.sendSucceeded = true;
    if (p.to_self === true) flags.sentToSelf = true;
  }
}

/** Distribution of the email-generation wait, ms. All values rounded. */
export interface WaitSummary {
  /** Number of email_preview_opened events carrying a usable wait_ms. */
  samples: number;
  median: number;
  p90: number;
  max: number;
}

/**
 * Median + p90 + max over raw wait samples. Nearest-rank (no interpolation)
 * apart from the even-length median, which averages the two middle values —
 * the usual convention, and the numbers are only ever read to the nearest
 * 100ms. Median and p90 stay meaningful even with a backgrounded-app outlier
 * in the tail, which is exactly why `max` is reported beside them.
 */
export function summariseWaits(samples: number[], decimals = 0): WaitSummary {
  const usable = samples.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (usable.length === 0) return { samples: 0, median: 0, p90: 0, max: 0 };
  const scale = 10 ** decimals;
  const round = (v: number) => Math.round(v * scale) / scale;

  const mid = Math.floor(usable.length / 2);
  const median =
    usable.length % 2 === 0 ? (usable[mid - 1] + usable[mid]) / 2 : usable[mid];
  const p90Index = Math.min(usable.length - 1, Math.ceil(usable.length * 0.9) - 1);

  return {
    samples: usable.length,
    median: round(median),
    p90: round(usable[p90Index]),
    max: round(usable[usable.length - 1]),
  };
}

/** The subset of a funnel input the send-flow rollup needs. */
export type SendFlowUserInput = Pick<EventFunnelUserInput, 'hasSentDoc' | 'send'>;

/** True iff we have evidence — durable or event — that the user sent. */
export function hasSendEvidence(input: SendFlowUserInput): boolean {
  return input.hasSentDoc || input.send?.sendSucceeded === true;
}

/**
 * How far into the send flow a user got. Null means they never entered it.
 * Later steps imply earlier ones, and an abandoned preview implies an opened
 * one (you cannot bail out of a screen you never reached) — the client writes
 * are independent, so either half can go missing on its own.
 */
export function furthestSendStage(input: SendFlowUserInput): SendStage | null {
  const send = input.send;
  if (hasSendEvidence(input)) return 'quote_sent';
  if (send?.openedEmailPreview || send?.abandonedEmailPreview) return 'email_preview_opened';
  if (send?.choseSendMethod) return 'method_chosen';
  if (send?.openedSendSheet) return 'send_sheet_opened';
  return null;
}

export interface SendFlowBreakdown {
  /** Cumulative reach: users at or past each step of the main ladder. */
  sheetOpened: number;
  methodChosen: number;
  sent: number;
  /** Step conversion, each as a fraction of the previous step. */
  pctMethodChosen: number;
  pctSent: number;
  /** Users per method picked; a tradie who tried two counts in both. */
  methods: Record<SendMethod, number>;
  /** Email branch only — the other three methods never see a preview. */
  email: {
    /** Reached the generated email body (the wait_ms moment). */
    previewOpened: number;
    /** Backed out of the preview at least once. */
    previewAbandoned: number;
    /** Backed out but sent in the end — tells us whether bailing is fatal. */
    abandonedThenSent: number;
    /** previewOpened as a fraction of tradies who picked email. */
    pctPreviewOpened: number;
    /** previewAbandoned as a fraction of previewOpened. */
    pctPreviewAbandoned: number;
    /** How long tradies actually waited for the body to generate. */
    waitMs: WaitSummary;
  };
  /** Sends the tradie addressed to themselves — not a real customer send. */
  selfSends: number;
  /** Sends proven ONLY by document stage, with no quote_send_succeeded event. */
  durableOnlySends: number;
  /** Furthest step reached — where people stall inside the send flow. */
  histogram: Record<SendStage, number>;
}

/**
 * Roll per-user send-flow flags up into the admin breakdown.
 *
 * Reach counts come from the flags directly rather than from the histogram,
 * because of the branch noted at the top of this section: a tradie who sent by
 * SMS reached `sent` without ever seeing a preview, and counting them as a
 * preview-reacher would quietly inflate the one number this instrumentation
 * exists to measure.
 */
export function rollupSendFlow(inputs: SendFlowUserInput[]): SendFlowBreakdown {
  const histogram: Record<SendStage, number> = {
    send_sheet_opened: 0,
    method_chosen: 0,
    email_preview_opened: 0,
    quote_sent: 0,
  };
  const methods: Record<SendMethod, number> = { email: 0, sms: 0, share: 0, export_pdf: 0 };

  let sheetOpened = 0;
  let methodChosen = 0;
  let sent = 0;
  let previewOpened = 0;
  let previewAbandoned = 0;
  let abandonedThenSent = 0;
  let selfSends = 0;
  let durableOnlySends = 0;
  const waits: number[] = [];

  for (const input of inputs) {
    const stage = furthestSendStage(input);
    if (!stage) continue; // never entered the send flow — not part of this funnel
    histogram[stage]++;

    const send = input.send;
    const didSend = hasSendEvidence(input);
    const reachedPreview = send?.openedEmailPreview === true || send?.abandonedEmailPreview === true;

    // Cumulative reach. Entering the flow at ANY step implies the sheet opened;
    // reaching the preview implies a method was picked.
    sheetOpened++;
    if (send?.choseSendMethod || reachedPreview || didSend) methodChosen++;
    if (didSend) sent++;

    if (reachedPreview) previewOpened++;
    if (send?.abandonedEmailPreview) {
      previewAbandoned++;
      if (didSend) abandonedThenSent++;
    }

    for (const method of send?.methods ?? []) methods[method]++;
    if (send?.sentToSelf) selfSends++;
    if (didSend && !send?.sendSucceeded) durableOnlySends++;
    if (send?.previewWaitMs?.length) waits.push(...send.previewWaitMs);
  }

  return {
    sheetOpened,
    methodChosen,
    sent,
    pctMethodChosen: safeRatio(methodChosen, sheetOpened),
    pctSent: safeRatio(sent, methodChosen),
    methods,
    email: {
      previewOpened,
      previewAbandoned,
      abandonedThenSent,
      pctPreviewOpened: safeRatio(previewOpened, methods.email),
      pctPreviewAbandoned: safeRatio(previewAbandoned, previewOpened),
      waitMs: summariseWaits(waits),
    },
    selfSends,
    durableOnlySends,
    histogram,
  };
}
