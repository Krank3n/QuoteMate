/**
 * Contract for how the prompt lets Mate move a total.
 *
 * 4 Sep 2026, a $500 smoke-alarm job. The tradie said the price up front
 * ("It's going to cost $500"); Mate acknowledged it, drafted, priced, and let
 * it land at $414. Asked why, it went looking for a dial: first it re-priced
 * "Plasterboard wall plugs / anchors" from $35 to $56.38 EACH, then markup to
 * 52.3% (which overshot to $639), then 14.8%. The quote went to the customer
 * with $225.52 of wall plugs on it — and because a price edit stamps a row
 * manual/high-confidence, the "1 estimated row, verify before sending" warning
 * on that row went quiet at the same time.
 *
 * propose_set_total already existed and does this properly (its own named
 * line, rows keep their supplier prices). The prompt only forbade the markup
 * route, so the line-price route was open. These pin both halves: the tool is
 * the only way a total moves, and a price named before the draft is the total.
 */
import { describe, it, expect } from 'vitest';

import { MATE_SYSTEM_PROMPT } from '../systemPrompt';

const SET_TOTAL_TOOL = MATE_SYSTEM_PROMPT.split('\n').find((l) =>
  l.startsWith('- propose_set_total —'),
);

const TOTAL_SECTION = MATE_SYSTEM_PROMPT.split('\n\n').find((s) =>
  s.startsWith('Reading out a total'),
);

describe('Mate prompt — propose_set_total is the only dial', () => {
  it('still describes the tool', () => {
    expect(SET_TOTAL_TOOL).toBeTruthy();
  });

  it('rules out markup and the labour rate as a way to reach a figure', () => {
    expect(SET_TOTAL_TOOL).toMatch(/never steer them to markup or a labour rate/i);
  });

  it('rules out the line-price route the smoke-alarm job took', () => {
    expect(SET_TOTAL_TOOL).toMatch(/only way you move a total/i);
    expect(SET_TOTAL_TOOL).toMatch(/never reach a figure by editing a line's price/i);
  });

  it('says why: a unit price is a fact about a product', () => {
    expect(SET_TOTAL_TOOL).toMatch(/not a dial/i);
    expect(SET_TOTAL_TOOL).toMatch(/its own named line/i);
  });
});

describe('Mate prompt — a price named before the draft is the total', () => {
  it('still has the total section', () => {
    expect(TOTAL_SECTION).toBeTruthy();
  });

  it('tells Mate to carry a stated price through pricing and set it unprompted', () => {
    expect(TOTAL_SECTION).toMatch(/BEFORE the job is drafted/);
    expect(TOTAL_SECTION).toMatch(/without being asked again/i);
  });

  it('names the failure it is there to stop — promising to adjust it later', () => {
    expect(TOTAL_SECTION).toMatch(/adjust it after it prices/i);
  });

  it('holds the copy rules — no "AI", Aussie and gender-neutral', () => {
    expect(`${SET_TOTAL_TOOL}\n${TOTAL_SECTION}`).not.toMatch(/\bAI\b/);
    expect(`${SET_TOTAL_TOOL}\n${TOTAL_SECTION}`).not.toMatch(/\b(guys|blokes|fellas|lads|folks|fancy)\b/i);
  });
});
