/**
 * Audit 23 Sep 2026: "I don't know what to charge, that's why I downloaded
 * you" got a refusal, and "Just work it out" got the app's pre-filled $85
 * passed off as the tradie's own rate. These pin the prompt's answer.
 */
import { describe, it, expect } from 'vitest';
import { MATE_SYSTEM_PROMPT } from '../systemPrompt';

const SECTION = MATE_SYSTEM_PROMPT.split('\n\n').find((s) => s.startsWith('What to charge'));

describe('Mate prompt — what to charge', () => {
  it('has the section and names the tool', () => {
    expect(SECTION).toBeTruthy();
    expect(MATE_SYSTEM_PROMPT).toContain('- get_typical_rates —');
  });

  it('answers instead of refusing, and says the range as a range with its caveat', () => {
    expect(SECTION).toMatch(/call get_typical_rates for their trade and ANSWER/);
    expect(SECTION).toMatch(/never refuse/);
    expect(SECTION).toMatch(/area, experience and overheads/);
  });

  it('only ever saves the figure they pick, and routes it to the right card', () => {
    expect(SECTION).toMatch(/Never save or apply a figure off the range they haven't picked/);
    expect(SECTION).toMatch(/standardLabourRate true/);
  });

  it("never calls the app's starting value their rate, and never invents a figure", () => {
    expect(SECTION).toMatch(/NOT SET BY THEM/);
    expect(SECTION).toMatch(/never call it "your rate"/);
    expect(SECTION).toMatch(/Never make a number up/);
    expect(SECTION).not.toMatch(/\bAI\b/);
  });
});
