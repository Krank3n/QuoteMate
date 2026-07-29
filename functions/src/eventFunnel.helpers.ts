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
 * The send-flow sub-funnel at the bottom of this file zooms into the single
 * darkest stretch: what happens between opening the send sheet and a quote
 * actually going out. Same rules apply there.
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
  /**
   * Send-flow event flags. Undefined when the user recorded no events in the
   * window at all — which is the normal state for anyone who last used the app
   * before the send instrumentation shipped, NOT evidence they skipped a step.
   */
  send?: SendFlowFlags;
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
export interface UserEventFlags extends SendFlowFlags {
  viewedPaywall: boolean;
  startedCheckout: boolean;
}

function emptyEventFlags(): UserEventFlags {
  return { viewedPaywall: false, startedCheckout: false, ...emptySendFlowFlags() };
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
export function summariseWaits(samples: number[]): WaitSummary {
  const usable = samples.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (usable.length === 0) return { samples: 0, median: 0, p90: 0, max: 0 };

  const mid = Math.floor(usable.length / 2);
  const median =
    usable.length % 2 === 0 ? (usable[mid - 1] + usable[mid]) / 2 : usable[mid];
  const p90Index = Math.min(usable.length - 1, Math.ceil(usable.length * 0.9) - 1);

  return {
    samples: usable.length,
    median: Math.round(median),
    p90: Math.round(usable[p90Index]),
    max: Math.round(usable[usable.length - 1]),
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
