/**
 * Rules for jumping around the onboarding flow via the progress bar.
 *
 * The bar is a breadcrumb, not a shortcut: you can return to any step you've
 * already reached, but you can't leapfrog ahead into steps you've never seen.
 *
 * The one thing this must not allow is escaping the two mandatory gates.
 * Company name and trade are the only steps the flow refuses to advance past
 * (see isCurrentStepValid), so a jump that lands the user beyond an unsatisfied
 * gate would let them finish onboarding with no business name — which is the
 * field every quote and invoice is built on.
 *
 * Note the gate check reads CURRENT state, not "was it valid when you passed
 * it". Someone can walk to step 5, come back to step 1, clear the name, and
 * then try to jump forward again; that has to fail.
 */

/** Step keys the flow will not advance past while unsatisfied. */
const MANDATORY_KEYS = ['company', 'trade'] as const;

export interface StepNavState {
  /** 1-based id of the furthest step the user has actually reached. */
  maxStepReached: number;
  hasBusinessName: boolean;
  hasTradeCategory: boolean;
}

function isGateSatisfied(key: string | undefined, state: StepNavState): boolean {
  if (key === 'company') return state.hasBusinessName;
  if (key === 'trade') return state.hasTradeCategory;
  return true;
}

/**
 * True when the user may jump straight to `targetStep` (1-based).
 *
 * `steps` is the user's own dynamic step list — plumbers get an extra Reece
 * step, so positions differ between users and the list must be passed in
 * rather than assumed.
 */
export function canJumpToStep(
  steps: Array<{ key?: string }>,
  targetStep: number,
  state: StepNavState,
): boolean {
  if (!Number.isInteger(targetStep)) return false;
  if (targetStep < 1 || targetStep > steps.length) return false;

  // Never jump somewhere you haven't been. Clamped to the list length so a
  // shrinking flow (deselecting plumbing drops the Reece step) can't leave a
  // stale high-water mark pointing past the end.
  if (targetStep > Math.min(state.maxStepReached, steps.length)) return false;

  // Every mandatory gate BEFORE the target must currently hold. The target's
  // own gate doesn't — going back to fix an empty business name is the whole
  // point of being able to navigate backwards.
  for (let i = 0; i < targetStep - 1; i++) {
    const key = steps[i]?.key;
    if ((MANDATORY_KEYS as readonly string[]).includes(key ?? '') && !isGateSatisfied(key, state)) {
      return false;
    }
  }

  return true;
}
