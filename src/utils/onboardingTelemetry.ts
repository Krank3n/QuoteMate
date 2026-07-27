/**
 * Onboarding telemetry payload builders.
 *
 * Pure so the shapes can be asserted in tests — the screen just calls these
 * and hands the result to trackEvent / trackWebEvent / Firestore.
 *
 * Why this exists: as of the 2026-07 funnel audit the entire onboarding flow
 * emitted exactly one analytics event (`square_connected`), so a user who
 * quit mid-flow left no trace anywhere — the resume draft lives in
 * AsyncStorage and dies with the app. ~20% of signups never finish onboarding
 * (52% on web) and we could not say which step lost them.
 *
 * Two channels, deliberately:
 *   - events (users/{uid}/events)  — per-step impressions, lossy, fine.
 *   - progress (profile/onboarding) — last-seen step, durable. THIS is what
 *     makes abandonment visible: a doc with isOnboarded != true and a
 *     lastStepKey is a user who walked away at that step.
 */

/** Defaults the rates step ships with — used to tell "kept" from "set". */
export const DEFAULT_LABOR_RATE = 85;
export const DEFAULT_MARKUP = 30;

/**
 * The minimum a step list entry needs for telemetry. `key` matches
 * OnboardingStep, where it's optional — a step without one is unidentifiable
 * and is skipped rather than logged as a blank.
 */
export interface TelemetryStep {
  key?: string;
}

export interface StepProps {
  // Index signature so these drop straight into trackEvent's BaseProps.
  [prop: string]: string | number | boolean | null | undefined;
  step_key: string;
  /** 1-based position in the *dynamic* step list. */
  step_index: number;
  /**
   * Total steps for THIS user. Plumbers get a Reece step, so index alone is
   * ambiguous across users — always read it alongside step_key.
   */
  steps_total: number;
}

/**
 * Props describing the step the user is currently looking at.
 * Returns null when `currentStep` is out of range, or the step carries no
 * key, so a bad index can never write a garbage row.
 */
export function stepPropsFor(
  steps: TelemetryStep[],
  currentStep: number,
): StepProps | null {
  const step = steps[currentStep - 1];
  if (!step?.key) return null;
  return {
    step_key: step.key,
    step_index: currentStep,
    steps_total: steps.length,
  };
}

/** Durable progress mirrored to users/{uid}/profile/onboarding. */
export interface OnboardingProgress {
  lastStepKey: string;
  lastStepIndex: number;
  stepsTotal: number;
}

/**
 * Last-seen (not furthest-reached) is deliberate: the question this answers is
 * "where were they standing when they walked away", and someone who navigates
 * Back and then quits abandoned at the step they were actually on.
 */
export function progressFor(
  steps: TelemetryStep[],
  currentStep: number,
): OnboardingProgress | null {
  const props = stepPropsFor(steps, currentStep);
  if (!props) return null;
  return {
    lastStepKey: props.step_key,
    lastStepIndex: props.step_index,
    stepsTotal: props.steps_total,
  };
}

/** Everything the completion event needs to describe what got filled in. */
export interface CompletionInput {
  stepsTotal: number;
  skippedStepKeys: string[];
  hasLogo: boolean;
  hasBrandColor: boolean;
  hasAbn: boolean;
  hasPhone: boolean;
  squareConnected: boolean;
  reeceConnected: boolean;
  suppliersAdded: number;
  tradeCategoryCount: number;
  laborRate: number;
  markup: number;
  /** Epoch ms of the first step view, or null when it wasn't captured. */
  startedAt: number | null;
  /** Injectable clock so the duration is assertable. */
  now: number;
}

export interface CompletionProps {
  // Index signature so these drop straight into trackEvent's BaseProps.
  [prop: string]: string | number | boolean | null | undefined;
  steps_total: number;
  steps_skipped: number;
  skipped_keys: string;
  /**
   * The 2026-07 audit's strongest activation signal: users who filled 4 of
   * these sent quotes at 38% vs 10% for those who filled none. Precomputed so
   * the funnel can group on it without re-deriving from the business doc.
   */
  optional_fields_filled: number;
  has_logo: boolean;
  has_brand_color: boolean;
  has_abn: boolean;
  has_phone: boolean;
  square_connected: boolean;
  reece_connected: boolean;
  suppliers_added: number;
  trade_categories: number;
  rates_customised: boolean;
  duration_ms: number | null;
}

export function completionProps(input: CompletionInput): CompletionProps {
  const optional = [
    input.hasLogo,
    input.hasBrandColor,
    input.hasAbn,
    input.hasPhone,
    input.squareConnected,
  ];

  return {
    steps_total: input.stepsTotal,
    steps_skipped: input.skippedStepKeys.length,
    // Flat string — Firestore indexes arrays poorly for this kind of ad-hoc
    // grouping and the list is never more than a handful of short keys.
    skipped_keys: input.skippedStepKeys.join(','),
    optional_fields_filled: optional.filter(Boolean).length,
    has_logo: input.hasLogo,
    has_brand_color: input.hasBrandColor,
    has_abn: input.hasAbn,
    has_phone: input.hasPhone,
    square_connected: input.squareConnected,
    reece_connected: input.reeceConnected,
    suppliers_added: input.suppliersAdded,
    trade_categories: input.tradeCategoryCount,
    rates_customised:
      input.laborRate !== DEFAULT_LABOR_RATE || input.markup !== DEFAULT_MARKUP,
    duration_ms:
      input.startedAt === null ? null : Math.max(0, input.now - input.startedAt),
  };
}
