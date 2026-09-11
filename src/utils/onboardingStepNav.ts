/**
 * The onboarding step list, and the rules for jumping around it.
 *
 * There are two shapes, chosen by `flowSteps(short)`.
 *
 * SHORT (the default since Sep 2026) is a single step: business name and
 * trade, together, on one screen. Everything the old flow asked for up front
 * now gets asked where it actually matters — rates on the first job, suppliers
 * when Mate can't price something, ABN and phone at the first send, branding
 * and payments from Settings and the money moment. The whole point is that
 * nothing stands between signing up and a priced quote.
 *
 * LONG is the seven/eight-step flow that shipped before it, kept behind the
 * `config/onboarding.longFlow` kill switch (services/onboardingFlowConfig.ts)
 * so the change can be pulled back without a store build. It is not the
 * default and it is not reachable unless that flag is flipped on.
 *
 * Jump rules (the progress bar, which only the long flow shows): the bar is a
 * breadcrumb, not a shortcut — you can return to any step you've already
 * reached, but you can't leapfrog ahead into steps you've never seen.
 *
 * The one thing this must not allow is escaping the two mandatory gates.
 * Company name and trade are the only things the flow refuses to advance past
 * (see handleNext in the screen), so a jump that lands the user beyond an
 * unsatisfied gate would let them finish onboarding with no business name —
 * which is the field every quote and invoice is built on.
 *
 * Note the gate check reads CURRENT state, not "was it valid when you passed
 * it". Someone can walk to step 5, come back to step 1, clear the name, and
 * then try to jump forward again; that has to fail.
 */

/** Step keys the flow will not advance past while unsatisfied. */
const MANDATORY_KEYS = ['company', 'trade'] as const;

/** One entry in the flow: a stable key plus what the progress bar draws. */
export interface FlowStep {
  key: string;
  label: string;
  icon: string;
}

/**
 * The short flow's single step. It keeps the `company` key so the step-view
 * funnel still lines up with the old flow's first step — everything measured
 * against "step 1 viewed" carries straight over.
 */
const SHORT_FLOW: readonly FlowStep[] = [
  { key: 'company', label: 'Your business', icon: 'office-building' },
];

/** The long flow's fixed head. Reece / suppliers / payments follow. */
const LONG_FLOW_BASE: readonly FlowStep[] = [
  { key: 'company', label: 'Company', icon: 'office-building' },
  { key: 'trade', label: 'Trade', icon: 'hammer-wrench' },
  { key: 'contact', label: 'Contact', icon: 'card-account-details' },
  { key: 'branding', label: 'Branding', icon: 'palette' },
  { key: 'rates', label: 'Rates', icon: 'currency-usd' },
];

/**
 * The steps this user gets. `plumbing` only matters to the long flow, which
 * splices in the Reece step for plumbers; the short flow offers Reece later,
 * from the supplier book, rather than up front.
 */
export function flowSteps(
  short: boolean,
  options: { plumbing?: boolean } = {},
): FlowStep[] {
  if (short) return [...SHORT_FLOW];

  const items = [...LONG_FLOW_BASE];
  if (options.plumbing) items.push({ key: 'reece', label: 'Reece', icon: 'pipe' });
  // Suppliers sits after Reece (when shown) so plumbers can layer their local
  // hardware store on top of their maX trade prices, and before Payments so
  // the wow moment happens before the monetisation ask.
  items.push({ key: 'suppliers', label: 'Suppliers', icon: 'truck-delivery' });
  items.push({ key: 'payments', label: 'Payments', icon: 'credit-card-outline' });
  return items;
}

/**
 * Where a saved draft should resume. A draft written by the OLD seven-step
 * flow can name step 6 while the short flow has exactly one, so an unclamped
 * resume would land past the end of the list: no step content, no valid
 * telemetry row, and a Next button that completes nothing. Clamp into range
 * and the user simply resumes at the last step that still exists.
 */
export function clampResumeStep(savedStep: unknown, totalSteps: number): number {
  if (totalSteps < 1) return 1;
  if (typeof savedStep !== 'number' || !Number.isFinite(savedStep)) return 1;
  return Math.min(Math.max(1, Math.trunc(savedStep)), totalSteps);
}

/** Everything the screen takes from a saved draft about where it is. */
export interface DraftResume {
  /** The flow this draft resumes into. */
  steps: FlowStep[];
  currentStep: number;
  maxStepReached: number;
  /**
   * Skips that still refer to a step in this flow. A draft from the old flow
   * carries keys like `contact`, and a completion event reporting "contact
   * skipped" on a flow that never offered contact is a lie the funnel can't
   * see through.
   */
  skippedStepKeys: string[];
  /** Whether the draft had already moved past the first step. */
  resumed: boolean;
}

/**
 * Read a saved onboarding draft into the flow that's actually running. Takes
 * the parsed draft as it came off the device — any shape, any vintage, or
 * nothing at all — and answers only the questions about position.
 */
export function resumeDraft(draft: unknown, options: { longFlow: boolean }): DraftResume {
  const d: Record<string, unknown> =
    draft && typeof draft === 'object' ? (draft as Record<string, unknown>) : {};

  const categories = Array.isArray(d.selectedCategories) ? d.selectedCategories : [];
  const steps = flowSteps(!options.longFlow, { plumbing: categories.includes('plumbing') });

  const currentStep = clampResumeStep(d.currentStep, steps.length);
  const live = new Set(steps.map((s) => s.key));

  return {
    steps,
    currentStep,
    maxStepReached: Math.max(currentStep, clampResumeStep(d.maxStepReached, steps.length)),
    skippedStepKeys: Array.isArray(d.skippedStepKeys)
      ? d.skippedStepKeys.filter((k): k is string => typeof k === 'string' && live.has(k))
      : [],
    // Read from the SAVED step, not the clamped one: a seven-step draft
    // collapsed onto a one-step flow is still someone coming back.
    resumed: typeof d.currentStep === 'number' && d.currentStep > 1,
  };
}

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
