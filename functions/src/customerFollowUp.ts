/**
 * Which unanswered quotes and unpaid invoices get a follow-up email to the
 * customer, and when.
 *
 * The admin funnel measured how fast customers answer quotes: acceptances land
 * in a median of 20 hours, and 9 in 10 arrive within 11 days. A quote still
 * silent at 48 hours is the one worth chasing, so the first reminder goes at
 * 48 hours and the second at 7 days — both measured from the send. After that
 * the quote is treated as dead: never a third reminder, never once the customer
 * has responded, and never once the acceptance link has lapsed.
 *
 * Invoices are chased on their own clock — see the invoice section at the
 * bottom of this file. Both halves stay free of firebase-admin so the
 * selection rules can be unit-tested directly: the schedulers normalise
 * Firestore docs into FollowUpQuote / FollowUpInvoice and own the side
 * effects (minting tokens and pay links, sending, writing back).
 */

/** Acceptance tokens expire 30 days after they're minted. index.ts imports this — one number. */
export const TOKEN_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

/** First reminder: 48 hours after the send. */
export const FIRST_FOLLOW_UP_MS = 48 * 60 * 60 * 1000;

/** Second reminder: 7 days after the send. */
export const SECOND_FOLLOW_UP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The second reminder never lands sooner than this after the first, however
 * old the quote is. Without it a quote already past 7 days when it first
 * becomes eligible (a tradie switching auto follow-up on with a backlog, or
 * the send stamp only just becoming readable) would get both emails on
 * consecutive mornings — from the tradie's own business name.
 */
export const MIN_GAP_MS = SECOND_FOLLOW_UP_MS - FIRST_FOLLOW_UP_MS;

/** Two reminders, then we stop. */
export const MAX_FOLLOW_UPS = 2;

/**
 * When auto follow-up became the default. Quotes sent — and invoices falling
 * due — before this moment are never chased on the strength of the default
 * alone: see FollowUpOptions.openFromMs for why, and
 * isAutoCustomerFollowUpDefaulted for who it binds.
 *
 * Sydney midnight on the day the flip shipped. If the deploy slips, move this
 * with it: every day it lags the deploy is another day of back catalogue that
 * becomes chaseable the moment the schedulers go live.
 */
export const DEFAULT_ON_FROM_MS = Date.parse('2026-09-06T00:00:00+10:00');

export interface FollowUpQuote {
  /** For logging / mapping back to the Firestore doc. */
  id: string;
  /** Where the reminder would go. No address → no reminder. */
  customerEmail?: string | null;
  /**
   * How the quote first reached the customer. Only email sends carry an
   * inbox we can reliably follow up in; SMS/share/export sends (and a
   * cancelled Android share that marked the quote sent falsely) don't.
   * Legacy docs have no sendMethod and were always email sends.
   */
  sendMethod?: string | null;
  /**
   * Any sign the customer has already answered — respondedAt, or a legacy
   * acceptedAt/declinedAt. Set → never chase again.
   */
  respondedAtMs: number | null;
  /** The tradie muted auto follow-ups for this quote. */
  suppressAutoFollowUp?: boolean;
  /** When the quote was sent, ms epoch. Drives the reminder timing. */
  sentAtMs: number | null;
  /**
   * When the current acceptance token was minted, ms epoch. Its presence
   * proves the quote actually carries an acceptance link, and it anchors the
   * 30-day expiry — past that, the link in the email is dead and there's no
   * point sending.
   */
  acceptanceTokenCreatedAtMs: number | null;
  /** How many reminders have already gone out (0, 1, or more). */
  followUpCount: number;
  /** When the last reminder went out, ms epoch — anchors MIN_GAP_MS. */
  lastFollowUpAtMs?: number | null;
}

export interface FollowUpOptions {
  /**
   * The tradie's own addresses (business email, auth email). A quote sent to
   * one of these is a self-send — the app already treats those as "only sent
   * to your inbox", not a customer — and must never be chased as a customer.
   */
  ownEmails?: Array<string | null | undefined>;
  /**
   * Enrolment floor: never OPEN a chase on a document dated before this.
   * Quotes are dated by their send, invoices by their due date — the same
   * anchor each already times from.
   *
   * This exists because the setting flipped from opt-in to opt-out. Without a
   * floor, the flip would reach back through every enrolled account's history
   * and email customers about documents the tradie had long since moved on
   * from — the first run after the deploy, in one hit, over every account at
   * once. Callers pass DEFAULT_ON_FROM_MS for an account the default enrolled
   * and omit it for one that opted in explicitly, whose in-flight chases the
   * floor would otherwise silently kill.
   *
   * Only the FIRST reminder is gated: a sequence already under way finishes,
   * rather than stranding a customer halfway through one.
   */
  openFromMs?: number;
}

function normaliseEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Collapse a run's selections to at most one per customer.
 *
 * A tradie carrying three unanswered quotes — or three overdue invoices — for
 * the same client would otherwise fire three near-identical chases into one
 * inbox in the same minute, all signed with their own business name. That is
 * the pile-up onInvoiceOverdue already had to fix on the push side ("six
 * near-identical buzzes in a row every morning"), and it reads far worse in a
 * customer's inbox than in the tradie's notification tray.
 *
 * `anchorOf` decides who wins: the lowest value goes today, which in both
 * callers means the one that has been waiting longest. The rest are picked up
 * on following days — nothing is lost, because a chase only counts once it has
 * actually been sent, and every document leaves the queue for good after two.
 * So the backlog drains one customer-day at a time and cannot starve.
 */
function onePerCustomer<S>(
  selections: S[],
  emailOf: (selection: S) => string | null | undefined,
  anchorOf: (selection: S) => number,
): S[] {
  const kept = new Map<string, S>();
  for (const selection of selections) {
    const key = normaliseEmail(emailOf(selection));
    const held = kept.get(key);
    // Strictly-less keeps the first of two equally old candidates, so the pick
    // is deterministic for a given input order.
    if (!held || anchorOf(selection) < anchorOf(held)) kept.set(key, selection);
  }
  return [...kept.values()];
}

export interface FollowUpSelection {
  quote: FollowUpQuote;
  /** 1 = first reminder (48h), 2 = second reminder (7d). */
  followUpNumber: 1 | 2;
}

/**
 * Decide, for `now`, which quotes are due a customer follow-up and which
 * reminder each one is owed. Pure: same input, same output.
 */
export function selectQuotesForFollowUp(
  quotes: FollowUpQuote[],
  now: number,
  options: FollowUpOptions = {},
): FollowUpSelection[] {
  const out: FollowUpSelection[] = [];
  const own = new Set((options.ownEmails ?? []).map(normaliseEmail).filter(Boolean));

  for (const q of quotes) {
    // No inbox to reach, or the send never went by email — skip.
    if (!q.customerEmail) continue;
    if (q.sendMethod && q.sendMethod !== 'email') continue;
    // A quote the tradie sent to themselves is not a customer waiting.
    if (own.has(normaliseEmail(q.customerEmail))) continue;

    // Already answered, or the tradie muted this one.
    if (q.respondedAtMs != null) continue;
    if (q.suppressAutoFollowUp) continue;

    // No send stamp, or no acceptance link at all — nothing to chase.
    if (q.sentAtMs == null) continue;
    if (q.acceptanceTokenCreatedAtMs == null) continue;

    // The acceptance link has lapsed: a reminder would carry a dead link.
    // Same comparison as the acceptance page: valid up to and including day 30.
    if (now - q.acceptanceTokenCreatedAtMs > TOKEN_EXPIRATION_MS) continue;

    const count = q.followUpCount ?? 0;
    if (count >= MAX_FOLLOW_UPS) continue;

    const age = now - q.sentAtMs;
    if (count === 0 && age >= FIRST_FOLLOW_UP_MS) {
      // Enrolment floor — see FollowUpOptions.openFromMs.
      if (options.openFromMs != null && q.sentAtMs < options.openFromMs) continue;
      out.push({ quote: q, followUpNumber: 1 });
    } else if (count === 1 && age >= SECOND_FOLLOW_UP_MS) {
      const sinceLast = q.lastFollowUpAtMs == null ? Infinity : now - q.lastFollowUpAtMs;
      if (sinceLast >= MIN_GAP_MS) out.push({ quote: q, followUpNumber: 2 });
    }
  }

  // Anchored on the send: the quote that has been silent longest goes first,
  // which is also the one whose acceptance link lapses soonest and so has the
  // least time left to be chased at all.
  return onePerCustomer(out, (s) => s.quote.customerEmail, (s) => s.quote.sentAtMs ?? Infinity);
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/**
 * An invoice runs on a different clock from a quote. A quote is waiting on a
 * decision, so its clock starts at the send. An invoice is waiting on money,
 * and money isn't late until the due date has passed — so every boundary below
 * is measured from `dueAt`, never from the send.
 */

/**
 * First chase: 3 days past the due date. The grace period is deliberate — a
 * transfer sent on the due date can still be clearing on the day after it, and
 * a reminder that arrives while the money is in flight reads as an accusation.
 */
export const FIRST_INVOICE_FOLLOW_UP_MS = 3 * 24 * 60 * 60 * 1000;

/** Second chase: 10 days past the due date. */
export const SECOND_INVOICE_FOLLOW_UP_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * The second chase never lands sooner than this after the first, however far
 * past due the invoice already was when it first became eligible. Same guard
 * as MIN_GAP_MS on quotes, and it matters more here: two demands for money on
 * consecutive mornings, both signed with the tradie's business name, is how a
 * customer relationship gets damaged by an automation nobody asked for.
 */
export const INVOICE_MIN_GAP_MS = SECOND_INVOICE_FOLLOW_UP_MS - FIRST_INVOICE_FOLLOW_UP_MS;

/**
 * How far past due an invoice can be and still have a chase OPENED on it.
 *
 * The app's payment records go stale in a way its quote records don't. A
 * customer who pays cash or by direct transfer leaves no trace in the app, and
 * plenty of tradies never go back and mark the invoice paid — which is fine
 * while the only consequence is a push the tradie can ignore (onInvoiceOverdue)
 * and not fine at all when the consequence is an email to the customer, from
 * the tradie's business name, asking for money that may already have changed
 * hands. So a chase is only ever opened while the record is still likely to be
 * true. Older debts keep surfacing on the dashboard's follow-up nudge for the
 * tradie to chase by hand.
 *
 * Only the FIRST chase is gated on this: a sequence that has already started
 * finishes, rather than stranding a customer halfway through one.
 */
export const MAX_OVERDUE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Two chases, then we stop. Same as quotes. */
export const MAX_INVOICE_FOLLOW_UPS = 2;

/**
 * Statuses that still owe money. 'draft' never reached the customer, 'paid' is
 * settled and 'cancelled' was called off — none of those get chased.
 */
export const CHASEABLE_INVOICE_STATUSES = new Set(['sent', 'partial', 'overdue']);

export interface FollowUpInvoice {
  /** For logging / mapping back to the Firestore doc. */
  id: string;
  /** Where the reminder would go. No address → no reminder. */
  customerEmail?: string | null;
  /**
   * How the invoice first reached the customer. Same rule as quotes: only an
   * email send gives us an inbox to chase in, and legacy docs carrying no
   * sendMethod were always email sends.
   */
  sendMethod?: string | null;
  /** InvoiceStatus. Only CHASEABLE_INVOICE_STATUSES are chased. */
  status?: string | null;
  /** The tradie muted auto follow-ups for this invoice. */
  suppressAutoFollowUp?: boolean;
  /** First-send stamp, ms epoch. Its absence means nothing ever went out. */
  sentAtMs: number | null;
  /** When payment is due, ms epoch. Anchors every boundary above. */
  dueAtMs: number | null;
  /** What's still owed. Zero or less → settled, whatever `status` says. */
  balanceDue: number;
  /** How many chases have already gone out (0, 1, or more). */
  followUpCount: number;
  /** When the last chase went out, ms epoch — anchors INVOICE_MIN_GAP_MS. */
  lastFollowUpAtMs?: number | null;
}

export interface InvoiceFollowUpSelection {
  invoice: FollowUpInvoice;
  /** 1 = first chase (due + 3d), 2 = second chase (due + 10d). */
  followUpNumber: 1 | 2;
}

/**
 * Decide, for `now`, which invoices are due a customer chase and which
 * reminder each one is owed. Pure: same input, same output.
 */
export function selectInvoicesForFollowUp(
  invoices: FollowUpInvoice[],
  now: number,
  options: FollowUpOptions = {},
): InvoiceFollowUpSelection[] {
  const out: InvoiceFollowUpSelection[] = [];
  const own = new Set((options.ownEmails ?? []).map(normaliseEmail).filter(Boolean));

  for (const inv of invoices) {
    // No inbox to reach, or the send never went by email — skip.
    if (!inv.customerEmail) continue;
    if (inv.sendMethod && inv.sendMethod !== 'email') continue;
    // An invoice the tradie sent to themselves is not a customer who owes money.
    if (own.has(normaliseEmail(inv.customerEmail))) continue;

    if (!CHASEABLE_INVOICE_STATUSES.has(String(inv.status ?? ''))) continue;
    // The balance beats the status field: a payment recorded against the
    // invoice can settle it before anything rewrites `status`, and NaN or a
    // missing total must read as "nothing to chase", not as a debt.
    if (!(inv.balanceDue > 0)) continue;
    if (inv.suppressAutoFollowUp) continue;

    // Never sent, or no due date to measure from — nothing to chase.
    if (inv.sentAtMs == null) continue;
    if (inv.dueAtMs == null) continue;

    const count = inv.followUpCount ?? 0;
    if (count >= MAX_INVOICE_FOLLOW_UPS) continue;

    const overdueBy = now - inv.dueAtMs;
    if (count === 0) {
      if (overdueBy < FIRST_INVOICE_FOLLOW_UP_MS) continue;
      if (overdueBy > MAX_OVERDUE_AGE_MS) continue;
      // Enrolment floor — see FollowUpOptions.openFromMs. Dated by the due
      // date, not the send: an invoice raised months ago but only now falling
      // due is a live debt, not back catalogue.
      if (options.openFromMs != null && inv.dueAtMs < options.openFromMs) continue;
      out.push({ invoice: inv, followUpNumber: 1 });
    } else if (count === 1 && overdueBy >= SECOND_INVOICE_FOLLOW_UP_MS) {
      const sinceLast = inv.lastFollowUpAtMs == null ? Infinity : now - inv.lastFollowUpAtMs;
      if (sinceLast >= INVOICE_MIN_GAP_MS) out.push({ invoice: inv, followUpNumber: 2 });
    }
  }

  // Anchored on the due date: the deepest-overdue invoice is chased first.
  return onePerCustomer(out, (s) => s.invoice.customerEmail, (s) => s.invoice.dueAtMs ?? Infinity);
}
