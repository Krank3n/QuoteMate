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

/**
 * An amount, in any form Mate could read out.
 *
 * The digits-only version of this guard was not enough. Replacing "$1,232"
 * with "twelve thirty two" passed it while making the leak MORE likely: the
 * prompt tells voice Mate to say money in words, so a spelled-out example is
 * already in the register it speaks. Amount words are banned outright — the
 * prompt has no legitimate use for one, while "in dollars" as a unit on a
 * tool parameter is fine and stays.
 */
const AMOUNT = new RegExp(
  [
    // $1,232 / $8.50 / $50
    String.raw`\$\s?\d[\d,]*(?:\.\d+)?`,
    // A rate: "220 a square", "650 per day", "90 an hour", "130/h" — and the
    // same said in words, "ninety a room".
    String.raw`\b(?:\d[\d,]*|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s*(?:(?:a|an|per)\s+(?:square|sqm|room|metre|meter|hour|day|week)|\/\s*h(?:r|our)?)\b`,
    // digits pinned to money by the words either side
    String.raw`\b(?:nearest|call it|round it to|rate'?s|priced? at|worth)\s+\d[\d,]*\b`,
    String.raw`\b\d[\d,]*\s*(?:dollars|bucks|grand)\b`,
    // spelled-out amounts: two grand, a hundred bucks
    String.raw`\b(?:hundred|thousand|grand|bucks)\b`,
    // a spoken price said as two number words: one-eighty, four fifty,
    // eight fifty, twelve thirty. No non-money sentence in the prompt reads
    // like this, and every one of these was in it before this guard existed.
    String.raw`\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)[\s-](?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b`,
  ].join('|'),
  'gi',
);

const describeSurface = (name: string, text: string) => {
  it(`${name} states no amount Mate could read out as a total`, () => {
    expect(text.match(AMOUNT) ?? []).toEqual([]);
  });
};

describe('Mate carries no example money', () => {
  describeSurface('the system prompt', MATE_SYSTEM_PROMPT);

  const toolText = ALL_TOOL_DECLARATIONS.map((d) =>
    JSON.stringify({ description: d.description, parameters: d.parameters }),
  ).join('\n');
  describeSurface('every tool description', toolText);

  it('catches the figure that actually leaked', () => {
    expect("Set it to $1,232 — card's up.".match(AMOUNT)).toEqual(['$1,232']);
    expect('make the total $1,232'.match(AMOUNT)).toEqual(['$1,232']);
  });

  it('catches the spoken rewrites too — the first fix swapped one leak shape for a worse one', () => {
    for (const spoken of [
      'call it two grand',
      'make the plywood a hundred bucks',
      'add a one-eighty callout',
      "day rate's 650",
      'ninety a room',
      '220 a square ex GST',
      'labour rate to $130/h',
      'round it to the nearest 50',
      'two hundred and forty dollars',
    ]) {
      expect(spoken.match(AMOUNT), spoken).not.toBeNull();
    }
  });

  it('leaves non-amounts alone — units, percentages and counts are not money', () => {
    for (const fine of [
      'The rate per unit, in dollars.',
      'The total the tradie wants the customer to see, in dollars.',
      'bump markup to 30%',
      'change hours to 14',
      'that should be 12 not 6',
      'two coats on the ceiling',
      'one line, no headers',
    ]) {
      expect(fine.match(AMOUNT), fine).toBeNull();
    }
  });
});

describe('the rules the leak needed', () => {
  it('tells Mate every figure must be read this turn, from a tool or a context line', () => {
    expect(MATE_SYSTEM_PROMPT).toContain('There is not one real amount anywhere in these instructions');
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
