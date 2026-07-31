/**
 * Pure, dependency-free "Business health" funnel maths for the admin analytics
 * dashboard. All the logic the founder actually tracks (signup → trial → sent
 * quote → paying, and the trial→paid conversion rate) lives here so it is unit
 * testable without Firestore. The `adminFunnelStats` callable in adminCrm.ts is
 * a thin fetch-then-compute wrapper around these functions.
 *
 * Tier/status/billing derivation is reused from subscription.helpers.ts — the
 * single source of truth — never re-implemented here.
 */
import { deriveSubFields, isBilledSub, isRestoredStorePro, TRIAL_DAYS } from './subscription.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

// Signup-cohort windows offered alongside the all-time funnel. Each is a TRUE
// cohort — the same people followed through every step — so it answers "of the
// tradies who signed up in the last N days, how far did they get?".
export const COHORT_WINDOW_DAYS = [7, 28, 90] as const;

// A signup cohort can only contain paid conversions once its members have had
// time to finish a trial and be billed. Below this, `paying` is structurally
// near-zero and the rate is meaningless rather than bad — the UI says so
// instead of showing a scary 0%.
export const PAID_MATURITY_DAYS = TRIAL_DAYS + 3;

// A brand-new signup hasn't had a fair chance to send a quote yet, so
// "never sent a quote" only flags users past this grace window.
export const NEVER_SENT_GRACE_DAYS = 2;
// A trialing user is "expiring" when this few days (or fewer) remain.
export const EXPIRING_TRIAL_DAYS = 3;
// "Inactive" = no recorded activity for at least this many days.
export const INACTIVE_DAYS = 7;
// Cap each actionable list so the payload (and UI table) stays small.
export const ACTION_LIST_CAP = 50;

/** One user's inputs, already joined from auth + subscription + emailState + documents. */
export interface FunnelUserInput {
  uid: string;
  email: string | null;
  businessName?: string | null;
  /** Raw subscription doc data (users/{uid}/profile/subscription), or null. */
  sub: any | null;
  /** ms epoch — emailState.signupAt, falling back to auth creationTime. */
  signupAt: number | null;
  /** ms epoch — emailState.lastActivityAt, or null. */
  lastActivityAt: number | null;
  /** True iff the user has ≥1 document with stage !== 'draft' (see isActivatingDoc). */
  hasSentDoc: boolean;
}

export interface FunnelActionRow {
  uid: string;
  email: string | null;
  businessName: string | null;
  signupAt: number | null;
  lastActivityAt: number | null;
  trialDaysRemaining: number | null;
}

/** The four funnel steps plus the step-to-step rates. Shared by the all-time
 *  funnel and every signup cohort. */
export interface FunnelSteps {
  signups: number;
  startedTrial: number;
  sentQuote: number;
  /** Total paying headcount: billed + incident-restored store subs. */
  paying: number;
  /** Subset of `paying` with a verifiable billing record (drives MRR). */
  payingBilled: number;
  /** Subset of `paying` restored from incident-2026-07, awaiting device receipt re-sync. */
  payingRestored: number;
  // Each step as a fraction (0..1) of the previous step.
  pctStartedTrial: number;
  pctSentQuote: number;
  pctPaying: number;
}

/** One signup-cohort slice: everyone whose signupAt falls inside the window. */
export interface FunnelCohort extends FunnelSteps {
  days: number;
  /** Lower bound of the cohort (ms epoch) — signups on or after this. */
  since: number;
  /** False when the window is shorter than a trial + billing lag, so `paying`
   *  is structurally understated rather than genuinely bad. */
  matureForPaid: boolean;
  /** THE founder metric, scoped to this cohort. paying / startedTrial. */
  trialToPaid: number;
  /** sentQuote / signups, scoped to this cohort. */
  activationRate: number;
}

export interface FunnelPayload {
  funnel: FunnelSteps;
  conversion: {
    // THE number the founder tracks (target >= 0.05). paying / startedTrial.
    trialToPaid: number;
    // sentQuote / signups.
    activationRate: number;
  };
  /** Same funnel recomputed over signup cohorts, keyed by window in days.
   *  Lets the dashboard time-slice the app funnel without a second query. */
  cohorts: Record<string, FunnelCohort>;
  // Trialing users with <= EXPIRING_TRIAL_DAYS left, regardless of activity.
  // (The expiringTrialsInactive list below is the inactive subset that needs a nudge.)
  expiringTrials: number;
  actionable: {
    neverSentQuote: FunnelActionRow[];
    expiringTrialsInactive: FunnelActionRow[];
  };
  asOf: number;
  cached: boolean;
}

/** Zero-safe ratio: 0 (never NaN/Infinity) when the denominator is 0. */
export function safeRatio(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

/**
 * True when a single document counts as "activated" (the tradie actually sent
 * something). Primary signal is stage !== 'draft'; sentAt is only a fallback
 * because ~35% of sent-stage docs never recorded a sentAt. A missing stage is
 * treated as 'draft'.
 */
export function isActivatingDoc(doc: { stage?: unknown; sentAt?: unknown } | null | undefined): boolean {
  if (!doc) return false;
  const stage = typeof doc.stage === 'string' && doc.stage ? doc.stage : 'draft';
  if (stage !== 'draft') return true;
  return doc.sentAt !== undefined && doc.sentAt !== null;
}

function toActionRow(u: FunnelUserInput, trialDaysRemaining: number | null): FunnelActionRow {
  return {
    uid: u.uid,
    email: u.email,
    businessName: u.businessName ?? null,
    signupAt: u.signupAt,
    lastActivityAt: u.lastActivityAt,
    trialDaysRemaining,
  };
}

// Newest first, then cap.
function sortAndCap(rows: FunnelActionRow[]): FunnelActionRow[] {
  return rows.sort((a, b) => (b.signupAt || 0) - (a.signupAt || 0)).slice(0, ACTION_LIST_CAP);
}

/**
 * Compute the full funnel + conversion + actionable-cohort payload from the
 * joined per-user inputs. `now` is injectable for deterministic tests and is
 * threaded into deriveSubFields so all trial math uses the same clock.
 */
export function computeFunnelStats(inputs: FunnelUserInput[], now: number = Date.now()): FunnelPayload {
  let expiringTrials = 0;
  const neverSentQuote: FunnelActionRow[] = [];
  const expiringTrialsInactive: FunnelActionRow[] = [];

  // Per-user step flags, derived exactly once. Both the all-time funnel and
  // every cohort aggregate from this, so the windowed numbers can never drift
  // from the headline ones.
  const marks: UserMarks[] = [];

  for (const u of inputs) {
    const f = deriveSubFields(u.sub, now);

    marks.push({
      signupAt: u.signupAt,
      // A user "started a trial" iff their sub carries a trialStartedAt — this
      // covers trialing, trial_expired AND now-Pro users who converted.
      startedTrial: f.trialStartedAt !== null,
      sentQuote: u.hasSentDoc,
      // Headcount includes incident-restored store subs (their Apple/Google
      // billing kept running; only the Firestore billing record is missing).
      payingBilled: isBilledSub(u.sub),
      payingRestored: !isBilledSub(u.sub) && isRestoredStorePro(u.sub, now),
    });

    // Actionable: signed up, past the grace window, never sent anything.
    if (
      u.signupAt !== null &&
      !u.hasSentDoc &&
      now - u.signupAt >= NEVER_SENT_GRACE_DAYS * DAY_MS
    ) {
      neverSentQuote.push(toActionRow(u, f.trialDaysRemaining));
    }

    // Trial about to lapse (any activity). The inactive subset below is the
    // one that actually needs a nudge.
    const expiring =
      f.tier === 'trialing' &&
      f.trialDaysRemaining !== null &&
      f.trialDaysRemaining <= EXPIRING_TRIAL_DAYS;
    if (expiring) {
      expiringTrials++;
      const stale = u.lastActivityAt === null || now - u.lastActivityAt > INACTIVE_DAYS * DAY_MS;
      if (stale) expiringTrialsInactive.push(toActionRow(u, f.trialDaysRemaining));
    }
  }

  const funnel = aggregateSteps(marks);

  // Signup cohorts. Users with no signupAt at all can't be placed in a window,
  // so they only ever appear in the all-time figures.
  const cohorts: Record<string, FunnelCohort> = {};
  for (const days of COHORT_WINDOW_DAYS) {
    const since = now - days * DAY_MS;
    const steps = aggregateSteps(marks.filter((m) => m.signupAt !== null && m.signupAt >= since));
    cohorts[String(days)] = {
      ...steps,
      days,
      since,
      matureForPaid: days >= PAID_MATURITY_DAYS,
      trialToPaid: safeRatio(steps.paying, steps.startedTrial),
      activationRate: safeRatio(steps.sentQuote, steps.signups),
    };
  }

  return {
    funnel,
    conversion: {
      trialToPaid: safeRatio(funnel.paying, funnel.startedTrial),
      activationRate: safeRatio(funnel.sentQuote, funnel.signups),
    },
    cohorts,
    expiringTrials,
    actionable: {
      neverSentQuote: sortAndCap(neverSentQuote),
      expiringTrialsInactive: sortAndCap(expiringTrialsInactive),
    },
    asOf: now,
    cached: false,
  };
}

/** One user reduced to the flags the funnel counts, plus their signup time. */
interface UserMarks {
  signupAt: number | null;
  startedTrial: boolean;
  sentQuote: boolean;
  payingBilled: boolean;
  payingRestored: boolean;
}

/** Tally a set of already-derived users into the four funnel steps. */
function aggregateSteps(marks: UserMarks[]): FunnelSteps {
  const signups = marks.length;
  let startedTrial = 0;
  let sentQuote = 0;
  let payingBilled = 0;
  let payingRestored = 0;

  for (const m of marks) {
    if (m.startedTrial) startedTrial++;
    if (m.sentQuote) sentQuote++;
    if (m.payingBilled) payingBilled++;
    else if (m.payingRestored) payingRestored++;
  }

  const paying = payingBilled + payingRestored;
  return {
    signups,
    startedTrial,
    sentQuote,
    paying,
    payingBilled,
    payingRestored,
    pctStartedTrial: safeRatio(startedTrial, signups),
    pctSentQuote: safeRatio(sentQuote, startedTrial),
    pctPaying: safeRatio(paying, sentQuote),
  };
}
