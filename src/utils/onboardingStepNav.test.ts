import { describe, expect, it } from 'vitest';

import { canJumpToStep, type StepNavState } from './onboardingStepNav';

const STANDARD = [
  { key: 'company' },
  { key: 'trade' },
  { key: 'contact' },
  { key: 'branding' },
  { key: 'rates' },
  { key: 'suppliers' },
  { key: 'payments' },
];
const PLUMBER = [
  { key: 'company' },
  { key: 'trade' },
  { key: 'contact' },
  { key: 'branding' },
  { key: 'rates' },
  { key: 'reece' },
  { key: 'suppliers' },
  { key: 'payments' },
];

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
