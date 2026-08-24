// The real sighting (23 Aug 2026) and the shapes around it. A false NEGATIVE
// puts our own prompt on a tradie's screen; a false POSITIVE silently eats a
// reply — so the genuine-reply cases matter as much as the leak ones.

import { describe, it, expect } from 'vitest';
import { isLeakedModelOutput } from '../leakedOutput';

// Verbatim from the screenshot, trimmed to the opening.
const SIGHTED_LEAK = `Thought to self: The user wants me to start the conversation with a short Aussie greeting.
Greeting constraints:
- 1-2 sentences max.
- Dry, warm, slightly cheeky tradie humour.
- No emojis.
- Time of day: late night.

Okay, let's assemble this.
Greeting: "Burning the midnight oil? Should be sorting 'Bathroom retile' instead of scrolling."

Draft 1: "Burning the midnight oil? That`;

describe('isLeakedModelOutput', () => {
  it('catches the greeting chain-of-thought seen in production', () => {
    expect(isLeakedModelOutput(SIGHTED_LEAK)).toBe(true);
  });

  it('catches it from the very first chunk, before the bubble fills', () => {
    expect(isLeakedModelOutput('Thought to self: The user wants me')).toBe(true);
  });

  it('catches every bracketed prompt tag we send, greet included', () => {
    for (const tag of ['greet', 'narrate', 'narrate-done', 'pipeline-done', 'context']) {
      expect(isLeakedModelOutput(`[${tag}] do the thing`)).toBe(true);
    }
  });

  it('catches planning markers wherever they appear', () => {
    expect(isLeakedModelOutput('Constraints:\n- keep it short')).toBe(true);
    expect(isLeakedModelOutput("Okay, let's refine this.")).toBe(true);
    expect(isLeakedModelOutput('Right.\nDraft 2: "G\'day."')).toBe(true);
    expect(isLeakedModelOutput('Thinking: what do they need')).toBe(true);
  });

  it('leaves a genuine greeting alone', () => {
    expect(
      isLeakedModelOutput(
        "Burning the midnight oil? Should be sorting 'Bathroom retile' instead of scrolling. Tell me what you need.",
      ),
    ).toBe(false);
  });

  it('leaves ordinary replies alone', () => {
    const real = [
      "Drafted Dee's bathroom — tap Apply and I'll price it up.",
      'Got that plan. The bathroom is 3.1m x 2.4m and the ensuite is 2m x 1.8m.',
      "Two Hansens — Sister (...7919) or Thomas (...2922)?",
      'Only thing on that job is the invoice — no service report on file.',
      "Righto, that's drafted.",
      'I draft. You tap to confirm.',
    ];
    for (const t of real) expect(isLeakedModelOutput(t)).toBe(false);
  });

  it('does not trip on a quote that merely mentions a draft or a user', () => {
    expect(isLeakedModelOutput('That draft quote is still sitting there.')).toBe(false);
    expect(isLeakedModelOutput('The user manual for the pump is in the shed.')).toBe(false);
  });

  it('treats empty and whitespace as nothing to hide', () => {
    expect(isLeakedModelOutput('')).toBe(false);
    expect(isLeakedModelOutput('   ')).toBe(false);
  });
});
