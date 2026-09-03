/**
 * "Job won" prompt gating.
 *
 * After a tradie marks a quote accepted we offer Pro once — at the first
 * moment the app has visibly earned something. The decision is pure and the
 * storage is injected so the whole thing unit-tests on its own:
 *   - Pro (billed or comped) users never see it;
 *   - a trial user already has everything the sheet promises, so they only see
 *     it once their trial is nearly up (same window the dashboard waits for
 *     before it shows the trial countdown);
 *   - only on a quote that carries a real price — an unpriced quote would
 *     render "$0.00 accepted";
 *   - at most once per document, ever;
 *   - never more than once every 7 days per user.
 *
 * The caller reads the plan from getEffectivePlan() and the trial countdown
 * the same way DashboardScreen / TrialBanner do, then feeds both in here.
 * Persisted state follows the `follow_up_nudge_snoozes` AsyncStorage pattern.
 */

import type { EffectivePlan } from '../store/planGates';
import type { Document } from '../types/document';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** AsyncStorage key holding the WonPromptState blob. */
export const WON_PROMPT_KEY = 'won_prompt_state';

/**
 * How close to the end of a trial the offer is allowed to appear. Matches the
 * dashboard, which suppresses the trial countdown until the last 3 days so a
 * tradie mid-trial is never nagged about a plan they already have.
 */
export const WON_PROMPT_TRIAL_ENDING_DAYS = 3;

/** The persisted shape, backing the once-per-doc / once-per-7-days caps. */
export interface WonPromptState {
  /** Document ids the sheet has already been shown for. */
  shownDocIds: string[];
  /** When the sheet last appeared, epoch ms; null if it never has. */
  lastShownAt: number | null;
}

const EMPTY_STATE: WonPromptState = { shownDocIds: [], lastShownAt: null };

/**
 * Parse the AsyncStorage blob into a WonPromptState. Anything malformed — a
 * non-JSON string, a null, the wrong shape — is treated as empty so a corrupt
 * value can never wedge the prompt on or off.
 */
export function parseWonPromptState(raw: string | null | undefined): WonPromptState {
  if (!raw) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_STATE };
    const shownDocIds = Array.isArray(parsed.shownDocIds)
      ? parsed.shownDocIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const lastShownAt = typeof parsed.lastShownAt === 'number' ? parsed.lastShownAt : null;
    return { shownDocIds, lastShownAt };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/**
 * Whether to show the "job won" sheet for this win. `now` is injected so the
 * 7-day window is testable without mocking the clock.
 */
export function shouldShowWonPrompt(args: {
  plan: EffectivePlan;
  /** Whole days left in an active trial (ceil); null when not trialing. */
  trialDaysRemaining: number | null;
  docId: string;
  /** The accepted total. The sheet leads with this number, so it must be real. */
  total: number;
  shownDocIds: string[];
  lastShownAt: number | null;
  now: number;
}): boolean {
  const { plan, trialDaysRemaining, docId, total, shownDocIds, lastShownAt, now } = args;
  if (plan === 'pro') return false; // Pro (billed or comped) never sees it.
  if (plan === 'trial') {
    // Mid-trial they already have invoicing and payments — offering them Pro
    // would be nagging, not an offer. Only once the trial is nearly up.
    if (trialDaysRemaining === null) return false;
    if (trialDaysRemaining > WON_PROMPT_TRIAL_ENDING_DAYS) return false;
  }
  if (!docId) return false;
  // No price, no moment. An unpriced accepted quote would headline "$0.00" (or
  // "$NaN"), and it must not burn the 7-day budget either.
  if (!Number.isFinite(total) || total <= 0) return false;
  if (shownDocIds.includes(docId)) return false; // at most once per document
  // A lastShownAt in the future is clock skew, not a recent impression —
  // honouring it would disable the prompt until the phone's clock caught up.
  if (lastShownAt != null && lastShownAt <= now && now - lastShownAt < SEVEN_DAYS_MS) return false;
  return true;
}

/** Fold a freshly-shown win into the state to persist back. */
export function recordWonPromptShown(
  state: WonPromptState,
  docId: string,
  now: number,
): WonPromptState {
  return {
    shownDocIds: state.shownDocIds.includes(docId)
      ? state.shownDocIds
      : [...state.shownDocIds, docId],
    lastShownAt: now,
  };
}

export interface MaybeShowWonPromptArgs {
  /** The quote that was just accepted. */
  doc: Pick<Document, 'id' | 'total'>;
  plan: EffectivePlan;
  trialDaysRemaining: number | null;
  /**
   * True when the OS store-review prompt was requested on this same win — the
   * two must never stack, so the offer stands down.
   */
  reviewShown: boolean;
  now: number;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

/**
 * Decide, record, and report whether the sheet should be shown for this win.
 * Returns true only after the cap has actually been persisted — an impression
 * we failed to write down would be re-offered on the next win, which is the
 * cap failing open. Never throws: the offer must not disrupt the win it
 * follows.
 */
export async function maybeShowWonPrompt(args: MaybeShowWonPromptArgs): Promise<boolean> {
  const { doc, plan, trialDaysRemaining, reviewShown, now, getItem, setItem } = args;
  if (reviewShown) return false;
  try {
    const state = parseWonPromptState(await getItem(WON_PROMPT_KEY));
    const show = shouldShowWonPrompt({
      plan,
      trialDaysRemaining,
      docId: doc.id,
      total: Number(doc.total),
      shownDocIds: state.shownDocIds,
      lastShownAt: state.lastShownAt,
      now,
    });
    if (!show) return false;
    // Persist the cap BEFORE showing, so a crash mid-sheet can't re-offer.
    await setItem(WON_PROMPT_KEY, JSON.stringify(recordWonPromptShown(state, doc.id, now)));
    return true;
  } catch {
    return false;
  }
}
