import { fuzzyScoreQuote, levenshtein } from '../quoteFuzzy';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('deck', 'deck')).toBe(0);
  });
  it('counts single substitutions', () => {
    // raised vs raise = 1 deletion
    expect(levenshtein('raise', 'raised')).toBe(1);
    // deck vs debt = 2 substitutions (c->b, k->t)
    expect(levenshtein('deck', 'debt')).toBe(2);
  });
  it('handles empties', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });
});

describe('fuzzyScoreQuote', () => {
  // The motivating bug: tradie said "delete that raised deck quote", STT
  // gave us "raise debt". The old list_recent_quotes had no fuzzy match,
  // so Mate gave up and pestered the user for a job number twice.
  it('matches "raise debt" against "Raised deck with stairs"', () => {
    const score = fuzzyScoreQuote('raise debt', 'Raised deck with stairs', 'Gigar');
    expect(score).toBeGreaterThan(0);
  });

  it('scores an exact phrase match higher than a fuzzy one', () => {
    const exact = fuzzyScoreQuote('raised deck', 'Raised deck with stairs', 'Gigar');
    const fuzzy = fuzzyScoreQuote('raise debt', 'Raised deck with stairs', 'Gigar');
    expect(exact).toBeGreaterThan(fuzzy);
  });

  it('matches on the customer name alone', () => {
    const score = fuzzyScoreQuote('gigar', 'Raised deck with stairs', 'Gigar');
    expect(score).toBeGreaterThan(0);
  });

  it('tolerates a 1-char customer-name typo', () => {
    // STT often drops/doubles a consonant on names. "gigarr" should still hit "Gigar".
    const score = fuzzyScoreQuote('gigarr', 'Raised deck with stairs', 'Gigar');
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 for a completely unrelated query', () => {
    const score = fuzzyScoreQuote('bathroom renovation', 'Raised deck with stairs', 'Gigar');
    expect(score).toBe(0);
  });

  it('ranks the right candidate first among a draft set', () => {
    const drafts = [
      { jobName: 'Raised deck with stairs', customerName: 'Gigar' },
      { jobName: 'Ceiling lights', customerName: 'Karl' },
      { jobName: 'Kitchen paint', customerName: 'Petrula' },
    ];
    const scored = drafts
      .map((d) => ({ d, s: fuzzyScoreQuote('raise debt', d.jobName, d.customerName) }))
      .sort((a, b) => b.s - a.s);
    expect(scored[0].d.jobName).toBe('Raised deck with stairs');
    expect(scored[0].s).toBeGreaterThan(0);
    expect(scored[1].s).toBe(0);
  });

  it('does not match noise-length (1-2 char) tokens', () => {
    // A single-char query shouldn't pull a match on every doc.
    expect(fuzzyScoreQuote('a', 'Raised deck with stairs', 'Gigar')).toBe(0);
  });

  it('returns 0 for empty query', () => {
    expect(fuzzyScoreQuote('', 'foo', 'bar')).toBe(0);
    expect(fuzzyScoreQuote('   ', 'foo', 'bar')).toBe(0);
  });
});

// "I need to edit invoice 004" came back "couldn't find that one" (3 Sep
// 2026): the document number was never part of the match.
describe('fuzzyScoreQuote — document numbers', () => {
  it('matches a bare number, with or without the prefix and leading zeros, against the document number', () => {
    for (const q of ['004', '4', 'inv 004', 'INV-004', 'invoice 004', 'invoice 4', 'number 4', '#4']) {
      expect(fuzzyScoreQuote(q, 'Switchboard install', 'Sue and Peter Williamson', 'INV-004'), q).toBeGreaterThanOrEqual(60);
    }
  });

  it('does not match a different number, and still scores names when the query is not a number', () => {
    expect(fuzzyScoreQuote('005', 'Switchboard install', 'Sue Williamson', 'INV-004')).toBe(0);
    expect(fuzzyScoreQuote('004', 'Switchboard install', 'Sue Williamson', undefined)).toBe(0);
    expect(fuzzyScoreQuote('switchboard', 'Switchboard install', 'Sue Williamson', 'INV-004')).toBeGreaterThan(0);
  });

  it('a query that happens to contain digits alongside words is matched on words, not the number', () => {
    expect(fuzzyScoreQuote('deck 4 posts', 'Switchboard install', 'Sue', 'INV-004')).toBe(0);
  });
});
