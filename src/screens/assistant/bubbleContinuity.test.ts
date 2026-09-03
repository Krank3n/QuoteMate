/**
 * One bubble per reply. The three-fragment reply this pins is real: "No
 * worries — drafting that" / " new circuits," / " and we'll sort RCDs to
 * standard. I'll leave" arrived as three bubbles because the model ended a
 * turn at every tool call (voice, 3 Sep 2026).
 */
import { describe, it, expect } from 'vitest';
import { createBubbleContinuity, joinFragments } from './bubbleContinuity';

describe('createBubbleContinuity', () => {
  it('continues the last bubble when nothing from the tradie came between', () => {
    const c = createBubbleContinuity();
    c.closed({ id: 'b1', text: 'No worries — drafting that' });
    expect(c.takeContinuation()).toEqual({ id: 'b1', text: 'No worries — drafting that' });
  });

  it('starts fresh once the tradie has spoken', () => {
    const c = createBubbleContinuity();
    c.closed({ id: 'b1', text: 'Sound right?' });
    c.userTurn();
    expect(c.takeContinuation()).toBeNull();
  });

  it('hands the bubble over once — a continuation closes again through closed()', () => {
    const c = createBubbleContinuity();
    c.closed({ id: 'b1', text: 'first' });
    expect(c.takeContinuation()).not.toBeNull();
    expect(c.takeContinuation()).toBeNull();
    c.closed({ id: 'b1', text: 'first second' });
    expect(c.takeContinuation()).toEqual({ id: 'b1', text: 'first second' });
  });

  it('never continues an empty bubble, and forgets everything on reset', () => {
    const c = createBubbleContinuity();
    c.closed({ id: 'b1', text: '' });
    expect(c.takeContinuation()).toBeNull();
    c.closed({ id: 'b2', text: 'hello' });
    c.reset();
    expect(c.takeContinuation()).toBeNull();
  });
});

describe('joinFragments', () => {
  it('puts one space at a seam that has none', () => {
    expect(joinFragments('No worries — drafting that', 'new circuits,')).toBe('No worries — drafting that new circuits,');
  });

  it('keeps the seam as-is when either side already carries whitespace or the next piece is punctuation', () => {
    expect(joinFragments('No worries — drafting that', ' new circuits,')).toBe('No worries — drafting that new circuits,');
    expect(joinFragments('drafting that ', 'new circuits')).toBe('drafting that new circuits');
    expect(joinFragments('drafting that', ', new circuits')).toBe('drafting that, new circuits');
  });

  it('is a no-op around an empty side', () => {
    expect(joinFragments('', 'x')).toBe('x');
    expect(joinFragments('x', '')).toBe('x');
  });
});
