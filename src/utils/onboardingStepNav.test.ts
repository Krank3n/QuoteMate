import { describe, expect, it } from 'vitest';

import {
  canJumpToStep,
  clampResumeStep,
  flowSteps,
  resumeDraft,
  type StepNavState,
} from './onboardingStepNav';

// The long flow's two shapes, built the way the screen builds them so a change
// to flowSteps can't leave these navigation rules asserting a dead list.
const STANDARD = flowSteps(false);
const PLUMBER = flowSteps(false, { plumbing: true });
const SHORT = flowSteps(true);

const filledIn = (maxStepReached: number): StepNavState => ({
  maxStepReached,
  hasBusinessName: true,
  hasTradeCategory: true,
});

describe('canJumpToStep — visited steps', () => {
  it('allows jumping back to an earlier step already reached', () => {
    expect(canJumpToStep(STANDARD, 2, filledIn(5))).toBe(true);
    expect(canJumpToStep(STANDARD, 1, filledIn(5))).toBe(true);
  });

  it('allows jumping forward to a step already reached', () => {
    // Walked to 5, came back to 2, now wants to return to 5.
    expect(canJumpToStep(STANDARD, 5, filledIn(5))).toBe(true);
  });

  it('refuses to leapfrog into a step never reached', () => {
    expect(canJumpToStep(STANDARD, 6, filledIn(5))).toBe(false);
    expect(canJumpToStep(STANDARD, 7, filledIn(1))).toBe(false);
  });

  it('handles the plumber flow, where the list is one step longer', () => {
    expect(canJumpToStep(PLUMBER, 6, filledIn(8))).toBe(true);
    expect(canJumpToStep(PLUMBER, 8, filledIn(8))).toBe(true);
  });
});

describe('canJumpToStep — mandatory gates', () => {
  it('blocks jumping past an empty business name', () => {
    const state = { maxStepReached: 6, hasBusinessName: false, hasTradeCategory: true };
    expect(canJumpToStep(STANDARD, 3, state)).toBe(false);
    expect(canJumpToStep(STANDARD, 6, state)).toBe(false);
  });

  it('still lets the user go BACK to the step whose gate is unsatisfied', () => {
    // This is the whole point — they need to return to step 1 to fix it.
    const state = { maxStepReached: 6, hasBusinessName: false, hasTradeCategory: true };
    expect(canJumpToStep(STANDARD, 1, state)).toBe(true);
  });

  it('blocks jumping past an unselected trade but allows reaching the trade step', () => {
    const state = { maxStepReached: 6, hasBusinessName: true, hasTradeCategory: false };
    expect(canJumpToStep(STANDARD, 2, state)).toBe(true);
    expect(canJumpToStep(STANDARD, 3, state)).toBe(false);
  });

  it('re-checks gates against CURRENT state, not what was true when passed', () => {
    // Walked to step 6, went back and cleared the name, now tries to jump
    // forward again. Must fail, or onboarding completes with no business name.
    const cleared = { maxStepReached: 6, hasBusinessName: false, hasTradeCategory: true };
    expect(canJumpToStep(STANDARD, 5, cleared)).toBe(false);
  });

  it('allows the full range once both gates are satisfied', () => {
    for (let i = 1; i <= 7; i++) {
      expect(canJumpToStep(STANDARD, i, filledIn(7))).toBe(true);
    }
  });
});

describe('canJumpToStep — out of range', () => {
  it('rejects zero, negative and past-the-end targets', () => {
    expect(canJumpToStep(STANDARD, 0, filledIn(7))).toBe(false);
    expect(canJumpToStep(STANDARD, -1, filledIn(7))).toBe(false);
    expect(canJumpToStep(STANDARD, 8, filledIn(99))).toBe(false);
  });

  it('rejects non-integer targets', () => {
    expect(canJumpToStep(STANDARD, 2.5, filledIn(7))).toBe(false);
    expect(canJumpToStep(STANDARD, NaN, filledIn(7))).toBe(false);
  });

  it('clamps a stale high-water mark when the flow shrinks', () => {
    // Plumber reached step 8, then deselected plumbing: the Reece step is gone
    // and the list is back to 7. maxStepReached of 8 must not point past it.
    expect(canJumpToStep(STANDARD, 8, filledIn(8))).toBe(false);
    expect(canJumpToStep(STANDARD, 7, filledIn(8))).toBe(true);
  });

  it('is safe on an empty step list', () => {
    expect(canJumpToStep([], 1, filledIn(3))).toBe(false);
  });
});

describe('canJumpToStep — the short flow', () => {
  it('has nowhere to jump: the only step is the one you are on', () => {
    expect(canJumpToStep(SHORT, 1, filledIn(1))).toBe(true);
    expect(canJumpToStep(SHORT, 2, filledIn(9))).toBe(false);
  });
});

describe('flowSteps', () => {
  it('gives the short flow exactly one step, keyed company', () => {
    expect(SHORT.map(s => s.key)).toEqual(['company']);
  });

  it('does not splice a Reece step into the short flow for plumbers', () => {
    // Plumbers get Reece offered later, from the supplier book / Settings.
    expect(flowSteps(true, { plumbing: true }).map(s => s.key)).toEqual(['company']);
  });

  it('rebuilds the seven-step long flow behind the kill switch', () => {
    expect(STANDARD.map(s => s.key)).toEqual([
      'company',
      'trade',
      'contact',
      'branding',
      'rates',
      'suppliers',
      'payments',
    ]);
  });

  it('inserts Reece between rates and suppliers for a plumber on the long flow', () => {
    expect(PLUMBER.map(s => s.key)).toEqual([
      'company',
      'trade',
      'contact',
      'branding',
      'rates',
      'reece',
      'suppliers',
      'payments',
    ]);
  });

  it('gives every step a label and an icon for the progress bar', () => {
    for (const step of [...SHORT, ...PLUMBER]) {
      expect(step.label.length).toBeGreaterThan(0);
      expect(step.icon.length).toBeGreaterThan(0);
    }
  });

  it('returns a fresh array each call so a caller cannot mutate the flow', () => {
    const first = flowSteps(true);
    first.push({ key: 'bogus', label: 'Bogus', icon: 'alert' });
    expect(flowSteps(true).map(s => s.key)).toEqual(['company']);
  });
});

describe('clampResumeStep', () => {
  it('resumes an old seven-step draft at the last step the short flow still has', () => {
    // The regression: a draft written by the OLD flow names step 6, the short
    // flow has one step. Unclamped, the screen renders no step content, writes
    // no telemetry row and the Next button completes nothing.
    expect(clampResumeStep(6, 1)).toBe(1);
    expect(clampResumeStep(8, 1)).toBe(1);
  });

  it('resumes a long-flow draft where it left off when the flag is on', () => {
    expect(clampResumeStep(6, 7)).toBe(6);
    expect(clampResumeStep(7, 7)).toBe(7);
  });

  it('clamps a draft from a plumber flow down to a shorter non-plumber list', () => {
    expect(clampResumeStep(8, 7)).toBe(7);
  });

  it('floors a zero, negative or fractional saved step at 1', () => {
    expect(clampResumeStep(0, 7)).toBe(1);
    expect(clampResumeStep(-3, 7)).toBe(1);
    expect(clampResumeStep(2.7, 7)).toBe(2);
  });

  it('falls back to step 1 for a corrupt draft value', () => {
    expect(clampResumeStep(undefined, 7)).toBe(1);
    expect(clampResumeStep('6', 7)).toBe(1);
    expect(clampResumeStep(NaN, 7)).toBe(1);
    expect(clampResumeStep(Infinity, 7)).toBe(1);
  });

  it('never returns zero even if handed an empty flow', () => {
    expect(clampResumeStep(3, 0)).toBe(1);
  });
});

describe('resumeDraft', () => {
  // A draft exactly as the seven-step flow wrote it, abandoned on Branding.
  const OLD_DRAFT = {
    currentStep: 6,
    maxStepReached: 6,
    businessName: "Smith's Plumbing",
    selectedCategories: ['carpentry'],
    skippedStepKeys: ['contact', 'branding'],
    startedAt: 1_700_000_000_000,
  };

  it('resumes an abandoned seven-step draft on the one step that still exists', () => {
    // The regression this exists for: unclamped, the screen would sit on step
    // 6 of a one-step flow — no content rendered, no telemetry row, and a
    // button that completes nothing.
    const at = resumeDraft(OLD_DRAFT, { longFlow: false });
    expect(at.steps.map(s => s.key)).toEqual(['company']);
    expect(at.currentStep).toBe(1);
    expect(at.maxStepReached).toBe(1);
  });

  it('still counts that as a resume, not a fresh start', () => {
    expect(resumeDraft(OLD_DRAFT, { longFlow: false }).resumed).toBe(true);
    expect(resumeDraft({ currentStep: 1 }, { longFlow: false }).resumed).toBe(false);
  });

  it('drops skips for steps the running flow no longer has', () => {
    // Otherwise the completion event reports "contact skipped" on a flow that
    // never offered contact.
    expect(resumeDraft(OLD_DRAFT, { longFlow: false }).skippedStepKeys).toEqual([]);
  });

  it('keeps the skips that are still real when the kill switch is on', () => {
    const at = resumeDraft(OLD_DRAFT, { longFlow: true });
    expect(at.currentStep).toBe(6);
    expect(at.skippedStepKeys).toEqual(['contact', 'branding']);
  });

  it('resumes a plumber draft into the plumber flow', () => {
    const at = resumeDraft(
      { currentStep: 8, selectedCategories: ['plumbing'] },
      { longFlow: true },
    );
    expect(at.steps).toHaveLength(8);
    expect(at.currentStep).toBe(8);
  });

  it('clamps a plumber draft that lands in a non-plumber list', () => {
    // They picked plumbing, walked to step 8, then deselected it before quitting.
    const at = resumeDraft({ currentStep: 8, selectedCategories: [] }, { longFlow: true });
    expect(at.steps).toHaveLength(7);
    expect(at.currentStep).toBe(7);
  });

  it('never lets maxStepReached trail the step being resumed', () => {
    const at = resumeDraft({ currentStep: 5, maxStepReached: 2 }, { longFlow: true });
    expect(at.maxStepReached).toBe(5);
  });

  it('starts clean on a missing, empty or corrupt draft', () => {
    for (const draft of [undefined, null, {}, 'not a draft', 42, []]) {
      const at = resumeDraft(draft, { longFlow: false });
      expect(at.currentStep).toBe(1);
      expect(at.maxStepReached).toBe(1);
      expect(at.skippedStepKeys).toEqual([]);
      expect(at.resumed).toBe(false);
    }
  });

  it('ignores junk inside an otherwise valid draft', () => {
    const at = resumeDraft(
      { currentStep: '6', maxStepReached: null, skippedStepKeys: [1, null, 'contact'] },
      { longFlow: true },
    );
    expect(at.currentStep).toBe(1);
    expect(at.maxStepReached).toBe(1);
    expect(at.skippedStepKeys).toEqual(['contact']);
  });
});
