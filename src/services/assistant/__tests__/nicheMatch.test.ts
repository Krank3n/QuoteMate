/**
 * Matching a job blurb to a niche template.
 *
 * Every case below is a real answer the previous matcher gave. It scored
 * whole-string edit distance, so a blurb latched onto whichever template
 * shared its most COMMON word and the word naming the actual job counted for
 * no more than any other. A tradie quoting a deck got asked about their air
 * conditioner — or, worse, asked nothing at all and handed a draft.
 */
import { describe, it, expect } from 'vitest';
import { NICHE_TEMPLATES } from '../../../data/nicheTemplates';
import {
  buildWordWeights, scoreName, tokenise, stem, subjectWord, NICHE_MATCH_FLOOR,
} from '../nicheMatch';
import { resolveJobRequirements, GENERIC_SCOPE_QUESTIONS } from '../readTools';

const NAMES: string[] = NICHE_TEMPLATES.map((t: { name: string }) => t.name);
const WEIGHTS = buildWordWeights(NAMES);

/** What the real matcher would pick for a blurb. */
const bestMatch = (freeText: string): string | null => {
  let best: { name: string; score: number } | null = null;
  for (const name of NAMES) {
    const score = scoreName(freeText, name.toLowerCase(), WEIGHTS);
    if (!best || score > best.score) best = { name, score };
  }
  return best && best.score >= NICHE_MATCH_FLOOR ? best.name : null;
};

describe('the deck failures that started this', () => {
  it.each([
    ['2 meter by 5 meter deck', 'Deck Build'],   // was Split System Service
    ['deck repair', 'Deck Build'],               // was Fence Repair
    ['deck board replacement', 'Deck Build'],    // was Gutter Replacement
    ['decking board replacement', 'Deck Build'], // was Cabinet Door Replacement
    ['timber deck', 'Deck Build'],               // was Timber Paling Fence
    ['new deck', 'Deck Build'],                  // was no match at all
    ['replacing the decking boards', 'Deck Build'],
  ])('%s -> %s', (blurb, expected) => {
    expect(bestMatch(blurb)).toBe(expected);
  });
});

describe('it did not break what already worked', () => {
  it.each([
    ['colorbond fence repair', 'Colorbond Fence'],
    ['gutter replacement', 'Gutter Replacement'],
    ['split system service', 'Split System Service'],
    ['concrete driveway', 'Concrete Driveway'],
    ['bathroom repaint', 'Bathroom Renovation'],
    ['mow and edge the lawn', 'Lawn Mowing (Ride-On)'],
  ])('%s -> %s', (blurb, expected) => {
    expect(bestMatch(blurb)).toBe(expected);
  });
});

describe('saying nothing beats guessing', () => {
  it('returns no match for work no template covers', () => {
    // There is no tap niche. Silence is the honest answer — a wrong niche
    // means Mate asks the wrong questions with total confidence.
    expect(bestMatch('replace laundry taps')).toBeNull();
  });

  it('returns no match for a blurb with no trade words at all', () => {
    expect(bestMatch('hello mate how are you')).toBeNull();
    expect(bestMatch('')).toBeNull();
  });
});

describe('word weighting', () => {
  it('rates a word naming one trade above one shared across many', () => {
    // "deck" identifies a niche; "repair" appears all over and settles nothing.
    expect(WEIGHTS.get('deck')!).toBeGreaterThan(WEIGHTS.get('repair')!);
  });

  it('derives weights from the templates rather than a hand-written list', () => {
    const small = buildWordWeights(['Deck Build', 'Deck Repair', 'Fence Repair']);
    // "repair" is in two of three, "fence" in one — so fence must count more.
    expect(small.get('fence')!).toBeGreaterThan(small.get('repair')!);
  });
});

describe('subjectWord', () => {
  it('picks the rarest word the templates actually use', () => {
    expect(subjectWord(['colorbond', 'fence'], WEIGHTS)).toBe('colorbond');
  });

  it('breaks a tie toward the later word, because compounds are head-final', () => {
    // "timber deck" is a deck, not a fence.
    const w = new Map([['timber', 2], ['deck', 2]]);
    expect(subjectWord(['timber', 'deck'], w)).toBe('deck');
  });

  it('ignores words no template has ever heard of', () => {
    expect(subjectWord(['fix', 'the', 'deck'], WEIGHTS)).toBe('deck');
  });

  it('returns null when nothing in the blurb is known', () => {
    expect(subjectWord(['zzz', 'qqq'], WEIGHTS)).toBeNull();
  });
});

describe('tokenise', () => {
  it('drops dimensions and filler that say nothing about the trade', () => {
    expect(tokenise('2 meter by 5 meter deck')).toEqual(['deck']);
  });

  it('keeps multi-word trade names whole', () => {
    expect(tokenise('colorbond fence')).toEqual(['colorbond', 'fence']);
  });
});

describe('stem', () => {
  it('brings decking and deck together', () => {
    expect(stem('decking')).toBe(stem('deck'));
  });

  it('brings a plural and its singular together', () => {
    expect(stem('fences')).toBe(stem('fence'));
    expect(stem('boards')).toBe(stem('board'));
  });

  it('does not maul short words or double-s endings', () => {
    expect(stem('glass')).toBe('glass');
    expect(stem('gas')).toBe('gas');
  });
});

describe('a job no template covers still gets asked about', () => {
  // The rule Mate follows is "ask what the tool returns, don't invent
  // questions". An empty list turned that into "ask nothing", and the prompt's
  // soft exception did not save it: a tradie asked for a deck quote, got no
  // questions, and was told "there weren't any required deck questions for
  // this job type". The fallback is structural now, not a caveat.
  it('never hands back an empty question list', () => {
    for (const blurb of ['replace laundry taps', 'zzz qqq', '']) {
      const r = resolveJobRequirements({ freeText: blurb } as any);
      expect(r.mustAskQuestions.length).toBeGreaterThan(0);
    }
  });

  it('marks those questions as generic so Mate does not claim it knew the trade', () => {
    // There is no tap niche, so this is the honest no-match case.
    const r = resolveJobRequirements({ freeText: 'replace laundry taps' } as any);
    expect(r.genericScope).toBe(true);
    expect(r.mustAskQuestions).toEqual(GENERIC_SCOPE_QUESTIONS);
  });

  it('asks about what the pricing engine needs from any job', () => {
    const joined = GENERIC_SCOPE_QUESTIONS.join(' ').toLowerCase();
    expect(joined).toContain('size');
    expect(joined).toContain('work');
    expect(joined).toContain('material');
    expect(joined).toContain('access');
  });

  it('leaves a recognised niche using its OWN questions', () => {
    const r = resolveJobRequirements({ freeText: '2 meter by 5 meter deck' } as any);
    expect(r.genericScope).toBe(false);
    expect(r.matched.templateName).toBe('Deck Build');
    expect(r.mustAskQuestions).not.toEqual(GENERIC_SCOPE_QUESTIONS);
  });
})
