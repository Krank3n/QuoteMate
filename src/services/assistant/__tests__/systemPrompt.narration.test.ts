/**
 * Contract for the prompt's "say the thing, don't announce it" rule.
 *
 * The text brain runs without a thinking channel, so it has been known to
 * write its planning as ordinary reply text: a first paragraph narrating what
 * a tool returned and what the rules oblige it to ask ("no match for that
 * name and it's the first job, so I need to ask about ... all in one go"),
 * then the real questions. A tradie reads that paragraph. No client filter
 * can separate that prose from the reply that follows it (the server-side
 * adapter has already coalesced the text blocks), so the prompt has to stop
 * it at the source. This pins that rule and where it lives.
 */
import { describe, it, expect } from 'vitest';

import { MATE_SYSTEM_PROMPT } from '../systemPrompt';

/** The prompt is blank-line separated sections; grab the one we own. */
const STYLE_SECTION = MATE_SYSTEM_PROMPT.split('\n\n').find((s) => s.startsWith('Style'));

describe('Mate prompt — no narrating tool results or rules', () => {
  it('still has a Style section', () => {
    expect(STYLE_SECTION).toBeTruthy();
  });

  it('is a hard rule at the top of Style, so it reads before the softer style notes', () => {
    const lines = (STYLE_SECTION || '').split('\n');
    expect(lines[1]).toMatch(/^- HARD RULE: your reply is only what you'd say to the tradie out loud/);
  });

  it('forbids narrating tool results, the rules, and its own next step', () => {
    expect(STYLE_SECTION).toMatch(/never narrate what a tool came back with/i);
    expect(STYLE_SECTION).toMatch(/what these rules make you do/i);
    expect(STYLE_SECTION).toMatch(/what you're about to do and why/i);
  });

  it('names the two shapes that reached a real screen as things not to say', () => {
    expect(STYLE_SECTION).toMatch(/"no match, so I'll…"/);
    expect(STYLE_SECTION).toMatch(/"it's the first job, so I need to ask…"/);
  });

  it('ends on the one-line version of the rule', () => {
    expect(STYLE_SECTION).toMatch(/Say the thing; don't announce it\./);
  });

  it('does not duplicate the bracketed-tag rule, which stays with pricing narration', () => {
    expect(STYLE_SECTION).not.toMatch(/\[narrate\]|\[pipeline-done\]|\[context\]/);
    const narration = MATE_SYSTEM_PROMPT.split('\n\n').find((s) => s.startsWith('Pricing narration'));
    expect(narration).toMatch(/HARD RULE for both: the bracketed tags/);
  });

  it('holds the copy rules — no "AI", and gender-neutral', () => {
    expect(STYLE_SECTION).not.toMatch(/\bAI\b/);
    expect(STYLE_SECTION).not.toMatch(/\b(guys|blokes|fellas|lads|folks)\b/i);
  });
});
