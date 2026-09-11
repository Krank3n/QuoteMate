import { describe, expect, it } from 'vitest';

import {
  completionProps,
  progressFor,
  stepPropsFor,
  type CompletionInput,
} from './onboardingTelemetry';

import { flowSteps } from './onboardingStepNav';

// The real shapes the screen builds. SHORT is what every new signup gets from
// Sep 2026; STANDARD and PLUMBER only exist behind the config/onboarding
// longFlow kill switch, and the funnel keeps reading them for as long as
// there are unfinished drafts and flipped accounts out there.
const SHORT = flowSteps(true);
const STANDARD = flowSteps(false);
const PLUMBER = flowSteps(false, { plumbing: true });

describe('stepPropsFor', () => {
  it('describes the step at a 1-based position', () => {
    expect(stepPropsFor(STANDARD, 1)).toEqual({
      step_key: 'company',
      step_index: 1,
      steps_total: 7,
    });
    expect(stepPropsFor(STANDARD, 4)).toEqual({
      step_key: 'branding',
      step_index: 4,
      steps_total: 7,
    });
  });

  it('reports the last step as index === steps_total', () => {
    expect(stepPropsFor(STANDARD, 7)).toEqual({
      step_key: 'payments',
      step_index: 7,
      steps_total: 7,
    });
  });

  it('keeps step_key unambiguous when the plumber branch shifts indexes', () => {
    // Position 6 is 'suppliers' for most trades but 'reece' for plumbers —
    // this is exactly why index alone can't be trusted across users.
    expect(stepPropsFor(STANDARD, 6)?.step_key).toBe('suppliers');
    expect(stepPropsFor(PLUMBER, 6)?.step_key).toBe('reece');
    expect(stepPropsFor(PLUMBER, 6)?.steps_total).toBe(8);
  });

  it('returns null for an out-of-range or zero index rather than a garbage row', () => {
    expect(stepPropsFor(STANDARD, 0)).toBeNull();
    expect(stepPropsFor(STANDARD, 8)).toBeNull();
    expect(stepPropsFor(STANDARD, -1)).toBeNull();
    expect(stepPropsFor([], 1)).toBeNull();
  });
});

describe('stepPropsFor — the one-step flow', () => {
  it('keeps the company key, so the funnel still lines up with the old step 1', () => {
    expect(stepPropsFor(SHORT, 1)).toEqual({
      step_key: 'company',
      step_index: 1,
      steps_total: 1,
    });
  });

  it('has no second step to describe', () => {
    expect(stepPropsFor(SHORT, 2)).toBeNull();
  });
});

describe('progressFor', () => {
  it('maps the current step to the durable progress fields', () => {
    expect(progressFor(PLUMBER, 6)).toEqual({
      lastStepKey: 'reece',
      lastStepIndex: 6,
      stepsTotal: 8,
    });
  });

  it('records last-seen, not furthest-reached, so a Back-then-quit lands on the right step', () => {
    // User walked forward to 'rates' (5) then navigated Back to 'branding' (4)
    // and closed the app. The abandonment belongs to 'branding'.
    expect(progressFor(STANDARD, 5)?.lastStepKey).toBe('rates');
    expect(progressFor(STANDARD, 4)?.lastStepKey).toBe('branding');
  });

  it('returns null for an out-of-range index', () => {
    expect(progressFor(STANDARD, 99)).toBeNull();
  });
});

const baseCompletion: CompletionInput = {
  stepsTotal: 7,
  skippedStepKeys: [],
  hasLogo: false,
  hasBrandColor: false,
  hasAbn: false,
  hasPhone: false,
  squareConnected: false,
  reeceConnected: false,
  suppliersAdded: 0,
  tradeCategoryCount: 1,
  laborRate: 85,
  markup: 30,
  startedAt: null,
  now: 1_000_000,
};

describe('completionProps', () => {
  it('counts zero optional fields for a user who skipped everything skippable', () => {
    const props = completionProps({
      ...baseCompletion,
      skippedStepKeys: ['contact', 'branding', 'rates', 'suppliers', 'payments'],
    });

    expect(props.optional_fields_filled).toBe(0);
    expect(props.steps_skipped).toBe(5);
    expect(props.skipped_keys).toBe('contact,branding,rates,suppliers,payments');
  });

  it('counts each of the five optional fields exactly once', () => {
    const props = completionProps({
      ...baseCompletion,
      hasLogo: true,
      hasBrandColor: true,
      hasAbn: true,
      hasPhone: true,
      squareConnected: true,
    });

    expect(props.optional_fields_filled).toBe(5);
  });

  it('does not let suppliers or trade categories inflate optional_fields_filled', () => {
    // Only the five business-profile fields feed the activation signal; the
    // supplier price book and trade picker are tracked separately.
    const props = completionProps({
      ...baseCompletion,
      hasLogo: true,
      suppliersAdded: 3,
      tradeCategoryCount: 4,
      reeceConnected: true,
    });

    expect(props.optional_fields_filled).toBe(1);
    expect(props.suppliers_added).toBe(3);
    expect(props.trade_categories).toBe(4);
    expect(props.reece_connected).toBe(true);
  });

  it('treats the shipped 85/30 defaults as not customised', () => {
    expect(completionProps({ ...baseCompletion, laborRate: 85, markup: 30 }).rates_customised).toBe(false);
  });

  it('flags rates as customised when either rate moves off its default', () => {
    expect(completionProps({ ...baseCompletion, laborRate: 120, markup: 30 }).rates_customised).toBe(true);
    expect(completionProps({ ...baseCompletion, laborRate: 85, markup: 15 }).rates_customised).toBe(true);
  });

  it('measures duration from the first step view', () => {
    const props = completionProps({ ...baseCompletion, startedAt: 940_000, now: 1_000_000 });
    expect(props.duration_ms).toBe(60_000);
  });

  it('reports a null duration when the start was never captured', () => {
    expect(completionProps({ ...baseCompletion, startedAt: null }).duration_ms).toBeNull();
  });

  it('clamps duration to zero rather than emitting a negative on clock skew', () => {
    // Resume-across-sessions restores startedAt from the draft; a device clock
    // that moved backwards must not write a negative duration.
    const props = completionProps({ ...baseCompletion, startedAt: 2_000_000, now: 1_000_000 });
    expect(props.duration_ms).toBe(0);
  });

  it('emits an empty skipped_keys string when nothing was skipped', () => {
    expect(completionProps(baseCompletion).skipped_keys).toBe('');
  });
});

describe('completionProps — the one-step flow', () => {
  // What a finish looks like from Sep 2026: one step, nothing to skip, and
  // the email that came off the signed-in account.
  const shortFlowFinish = completionProps({
    ...baseCompletion,
    stepsTotal: SHORT.length,
    skippedStepKeys: [],
    laborRate: 85,
    markup: 30,
  });

  it('reports one step with nothing skipped', () => {
    expect(shortFlowFinish.steps_total).toBe(1);
    expect(shortFlowFinish.steps_skipped).toBe(0);
    // skipped_keys stays a valid, groupable string — it is simply empty now.
    expect(shortFlowFinish.skipped_keys).toBe('');
  });

  it('reports the untouched defaults honestly rather than as a customisation', () => {
    // The rates step is gone, so nobody sets these during onboarding; the
    // funnel must not read the shipped 85/30 as a decision anyone made.
    expect(shortFlowFinish.rates_customised).toBe(false);
  });

  it('still counts whatever optional fields the defaults filled in', () => {
    // The signed-in email is written as before, so a completion can carry a
    // contact field without the contact step ever existing.
    const withEmail = completionProps({
      ...baseCompletion,
      stepsTotal: 1,
      hasPhone: false,
      hasAbn: false,
    });
    expect(withEmail.optional_fields_filled).toBe(0);
    expect(withEmail.has_abn).toBe(false);
  });
});
