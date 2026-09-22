/**
 * When the dashboard asks a tradie to go Pro — the pure rules, so the two
 * surfaces that ask (the trial banner and the next-action card) can be
 * tested without rendering the animated home screen.
 *
 * 22 Sep 2026 audit, 30 days of events: 27 tradies finished a trial and kept
 * using the app, and the expired banner was shown to none of them — the
 * dashboard hid the trial card at "0 days left", which is also what an
 * expired trial reads as. The one selling card (continuity_choice, last 3
 * days of a trial after a first send) reached 2 people, because the
 * follow-up nudge owns the same slot and there is always a quote to chase.
 * Six in ten paywall views came from tradies opening Settings themselves.
 *
 * Rules:
 *   - A finished trial shows the expired banner every session until the
 *     tradie buys or says they're fine on Free (30 days of quiet, then ask
 *     once more).
 *   - In the last 3 days of a trial the selling card wins the slot over the
 *     follow-up nudge; the countdown banner steps aside for it so the home
 *     screen never carries two asks at once. Before a first send nothing
 *     sells — that rule lives in nextBestAction and is not relaxed here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Trial days remaining at which the countdown banner and the selling card appear. */
export const TRIAL_ASK_LAST_DAYS = 3;

/** AsyncStorage key: epoch-ms until which every proactive Pro ask stays quiet. */
export const HAPPY_ON_FREE_KEY = 'happy_on_free_until';
export const HAPPY_ON_FREE_MS = 30 * DAY_MS;

export function parseHappyOnFree(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isHappyOnFree(until: number | null | undefined, now: number = Date.now()): boolean {
  return typeof until === 'number' && until > now;
}

export interface TrialBannerGateInput {
  /** A trial has started (trialStartedAt set); the banner has nothing to say before that. */
  hasTrial: boolean;
  isPro: boolean;
  /** The welcome-back card already carries the days left. */
  returnNoticeVisible: boolean;
  happyOnFree: boolean;
  trialExpired: boolean;
  daysRemaining: number | null;
  /** The next-action card on screen is a selling card — it carries the ask. */
  sellingCardShown: boolean;
}

export function showDashboardTrialBanner(input: TrialBannerGateInput): boolean {
  if (!input.hasTrial || input.isPro || input.returnNoticeVisible || input.happyOnFree) return false;
  if (input.trialExpired) return true;
  if (input.daysRemaining === null || input.daysRemaining > TRIAL_ASK_LAST_DAYS) return false;
  return !input.sellingCardShown;
}

export interface SlotInput {
  /** An in-progress draft owns the slot outright — it is the freshest work. */
  draftActive: boolean;
  /** pickFollowUpNudge found something to chase. */
  nudgeAvailable: boolean;
  /** Snoozes have been read; before that nothing renders, so nothing flashes. */
  snoozesLoaded: boolean;
  /** nextBestAction says this is a moment to sell. */
  sellingAllowed: boolean;
}

/** Whether the next-action card must stand down. A selling card outranks the nudge. */
export function nextCardSlotTaken(input: SlotInput): boolean {
  if (input.draftActive || !input.snoozesLoaded) return true;
  if (input.sellingAllowed) return false;
  return input.nudgeAvailable;
}

/** The nudge yields to a card that is actually a Pro ask, and to nothing else. */
export function nudgeYieldsToCard(card: { route: { screen: string } } | null | undefined): boolean {
  return !!card && card.route.screen === 'Paywall';
}
