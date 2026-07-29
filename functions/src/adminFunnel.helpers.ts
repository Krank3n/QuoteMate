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
import { deriveSubFields, isBilledSub, isRestoredStorePro } from './subscription.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

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

export interface FunnelPayload {
  funnel: {
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
  };
  conversion: {
    // THE number the founder tracks (target >= 0.05). paying / startedTrial.
    trialToPaid: number;
    // sentQuote / signups.
    activationRate: number;
  };
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
 * The established test-account pattern, lifted verbatim from the one-off
 * analysis scripts (funnelBreakdown / selfSendAnalysis / jobPreviewStallAnalysis)
 * so every funnel counts the same population. Matched against BOTH the auth
 * email and the display name, because our seeded accounts are inconsistent
 * about which field carries the giveaway.
 */
export const TEST_ACCOUNT_PATTERN = /example\.com$|mate\.debug|newtestuser|testuser@|^qm-marketing-demo$/i;

/** True when an auth record is one of ours, not a real tradie. */
export function isTestAccount(
  email: string | null | undefined,
  displayName?: string | null | undefined
): boolean {
  return TEST_ACCOUNT_PATTERN.test(email || '') || TEST_ACCOUNT_PATTERN.test(displayName || '');
}

/**
 * Documents whose id starts with `recovered-` are email-derived single-line
 * reconstructions written by the 2026-07 account-reclaim rebuild, not quotes a
 * tradie actually authored in the app. They carry a sent-looking stage, so any
 * funnel that counts them reads a send that never happened — exclude them
 * everywhere (see accountReclaim.rebuild.ts for how they're minted).
 */
export function isRecoveredDocId(docId: string | null | undefined): boolean {
  return typeof docId === 'string' && docId.startsWith('recovered-');
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
  const signups = inputs.length;
  let startedTrial = 0;
  let sentQuote = 0;
  let payingBilled = 0;
  let payingRestored = 0;

  let expiringTrials = 0;
  const neverSentQuote: FunnelActionRow[] = [];
  const expiringTrialsInactive: FunnelActionRow[] = [];

  for (const u of inputs) {
    const f = deriveSubFields(u.sub, now);

    // Funnel steps. A user "started a trial" iff their sub carries a
    // trialStartedAt — this covers trialing, trial_expired AND now-Pro users
    // who converted from a trial.
    if (f.trialStartedAt !== null) startedTrial++;
    if (u.hasSentDoc) sentQuote++;
    // Headcount includes incident-restored store subs (their Apple/Google
    // billing kept running; only the Firestore billing record is missing).
    if (isBilledSub(u.sub)) payingBilled++;
    else if (isRestoredStorePro(u.sub, now)) payingRestored++;

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

  const paying = payingBilled + payingRestored;

  return {
    funnel: {
      signups,
      startedTrial,
      sentQuote,
      paying,
      payingBilled,
      payingRestored,
      pctStartedTrial: safeRatio(startedTrial, signups),
      pctSentQuote: safeRatio(sentQuote, startedTrial),
      pctPaying: safeRatio(paying, sentQuote),
    },
    conversion: {
      trialToPaid: safeRatio(paying, startedTrial),
      activationRate: safeRatio(sentQuote, signups),
    },
    expiringTrials,
    actionable: {
      neverSentQuote: sortAndCap(neverSentQuote),
      expiringTrialsInactive: sortAndCap(expiringTrialsInactive),
    },
    asOf: now,
    cached: false,
  };
}
