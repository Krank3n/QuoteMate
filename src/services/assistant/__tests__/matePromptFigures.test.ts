/**
 * No real money in the instructions.
 *
 * 4 Sep 2026: Mate told a tradie their quote's total was "$1,232". The quote
 * was $1,987.90. The figure was not a stale total, not a rounding slip and not
 * a tool result — it was lifted verbatim out of Mate's own context, where
 * "Set it to $1,232 — card's up." sat as an example in the system prompt and
 * "make the total $1,232" sat in the propose_set_total description. Asked
 * about it, Mate then invented a reason ("when the quote was built, the
 * pricing came out higher"), which is how a copied example becomes a tradie
 * believing the app moved their money on its own.
 *
 * Illustrative figures are indistinguishable from real ones once they're in
 * the window, so the fix is that there are none. Examples keep their shape in
 * spoken word form ("call it two grand") — which is how a tradie says it
 * anyway, and which no one can mistake for a document total.
 */
import { describe, expect, it } from 'vitest';
import { MATE_SYSTEM_PROMPT } from '../systemPrompt';
import { ALL_TOOL_DECLARATIONS } from '../toolSchemas';

/** "$1,232", "$8.50", "$50" — a currency symbol against digits. */
const DOLLAR_FIGURE = /\$\s?\d[\d,]*(?:\.\d+)?/g;

const describeSurface = (name: string, text: string) => {
  it(`${name} states no dollar figure Mate could read out as a total`, () => {
    expect(text.match(DOLLAR_FIGURE) ?? []).toEqual([]);
  });
};

describe('Mate carries no example money', () => {
  describeSurface('the system prompt', MATE_SYSTEM_PROMPT);

  const toolText = ALL_TOOL_DECLARATIONS.map((d) =>
    JSON.stringify({ description: d.description, parameters: d.parameters }),
  ).join('\n');
  describeSurface('every tool description', toolText);

  it('the guard would have caught the figure that actually leaked', () => {
    expect('Set it to $1,232 — card\'s up.'.match(DOLLAR_FIGURE)).toEqual(['$1,232']);
    expect('make the total $1,232'.match(DOLLAR_FIGURE)).toEqual(['$1,232']);
  });

  it('leaves spoken word amounts alone — they are how a tradie says it', () => {
    expect('call it two grand'.match(DOLLAR_FIGURE)).toBeNull();
    expect("the decking's eight fifty a metre".match(DOLLAR_FIGURE)).toBeNull();
  });
});

describe('the rules the leak needed', () => {
  it('tells Mate every figure must be read this turn, from a tool or a context line', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('There is not one real dollar figure anywhere in these instructions');
  });

  it('forbids explaining a total the tradie disputes', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('Never explain the difference');
  });

  it('keeps stated constraints in the scope and bans invented access', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('No scaffolding — access off ladders.');
    expect(MATE_SYSTEM_PROMPT).toContain('Never invent an access method');
  });

  it('bans asking the tradie to read out a quote number', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('NEVER ask the tradie to read you a quote number');
    expect(MATE_SYSTEM_PROMPT).not.toContain('Asking for an id is the move of last resort');
  });

  it('gives the sent-quote refusal a way out', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('That refusal is NOT a dead end');
  });
});
