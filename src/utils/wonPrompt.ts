/**
 * "Job won" prompt gating.
 *
 * After a tradie marks a quote accepted we offer Pro once — at the first
 * moment the app has visibly earned something. This is the pure decision, kept
 * free of the store and AsyncStorage so it unit-tests on its own:
 *   - Pro (billed or comped) users never see it;
 *   - at most once per document, ever;
 *   - never more than once every 7 days per user.
 *
 * The caller reads the plan from getEffectivePlan() and the persisted state
 * from AsyncStorage (see the `follow_up_nudge_snoozes` pattern in
 * DashboardScreen), then feeds both in here.
 */

import type { EffectivePlan } from '../store/planGates';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
  docId: string;
  shownDocIds: string[];
  lastShownAt: number | null;
  now: number;
}): boolean {
  const { plan, docId, shownDocIds, lastShownAt, now } = args;
  if (plan === 'pro') return false; // Pro (billed or comped) never sees it.
  if (!docId) return false;
  if (shownDocIds.includes(docId)) return false; // at most once per document
  if (lastShownAt != null && now - lastShownAt < SEVEN_DAYS_MS) return false;
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
