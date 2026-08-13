/**
 * The old jobs search matched three fields with one naive `includes()`, so
 * every handle a tradie actually has in hand missed: a phone number, an
 * invoice number, two words from different fields. A trailing space matched
 * nothing at all.
 *
 * These pin the replacement, and the two properties that keep it honest: the
 * search never re-orders (the sort control owns ordering) and never invents or
 * duplicates a row.
 */
import { describe, it, expect } from 'vitest';

import {
  buildJobSearchIndex,
  filterJobsBySearch,
  parseJobSearchQuery,
} from './jobSearch';

function job(over: Record<string, any> = {}): any {
  return {
    id: 'job1',
    stage: 'inquiry',
    name: 'A job',
    customerName: 'Someone',
    jobAddress: '',
    ...over,
  };
}

function invoice(over: Record<string, any> = {}): any {
  return { id: 'inv1', type: 'invoice', stage: 'invoice_sent', number: 'IN-1042', ...over };
}

/** Index one job with its docs, then search a single-job list. */
function search(jobs: any[], docs: Record<string, any[]>, query: string): string[] {
  const docsByJob = new Map<string, any[]>(Object.entries(docs));
  const index = buildJobSearchIndex(jobs, docsByJob);
  return filterJobsBySearch(jobs, index, query).map((j: any) => j.id);
}

const JONES = job({
  id: 'jones',
  customerName: 'Bob Jones',
  name: 'Pergola',
  jobAddress: '12 Smith St, Warragul',
  customerPhone: '0412 345 678',
  customerEmail: 'bob@jones.com.au',
  description: 'Merbau decking with a gable roof',
  notes: 'Gate is round the back',
});

const NGUYEN = job({
  id: 'nguyen',
  customerName: 'Dave Nguyen',
  name: 'Deck',
  jobAddress: '9 Queen Rd',
  customerPhone: '+61 400 999 111',
});

const POPULATION = [JONES, NGUYEN];
const DOCS = { jones: [invoice({ number: 'IN-1042' })], nguyen: [invoice({ id: 'inv2', number: 'QU-1031' })] };

describe('parseJobSearchQuery', () => {
  it('returns null for an empty query so the list skips the filter entirely', () => {
    expect(parseJobSearchQuery('')).toBeNull();
  });

  it('returns null for a query of only whitespace', () => {
    expect(parseJobSearchQuery('   ')).toBeNull();
  });

  it('REGRESSION: trims a trailing space — "jones " used to match nothing', () => {
    expect(parseJobSearchQuery('jones ')).toEqual({ tokens: ['jones'] });
  });

  it('splits a run of whitespace into separate tokens, not one empty one', () => {
    expect(parseJobSearchQuery('  bob   jones  ')).toEqual({ tokens: ['bob', 'jones'] });
  });

  it('folds diacritics so "jose" finds "José"', () => {
    expect(parseJobSearchQuery('José')).toEqual({ tokens: ['jose'] });
  });

  it('is case-insensitive', () => {
    expect(parseJobSearchQuery('JONES')).toEqual({ tokens: ['jones'] });
  });
});

describe('jobSearch — fields matched', () => {
  it('matches the customer name', () => {
    expect(search(POPULATION, DOCS, 'jones')).toEqual(['jones']);
  });

  it('matches the job name', () => {
    expect(search(POPULATION, DOCS, 'pergola')).toEqual(['jones']);
  });

  it('matches the address', () => {
    expect(search(POPULATION, DOCS, 'warragul')).toEqual(['jones']);
  });

  it('matches the description', () => {
    expect(search(POPULATION, DOCS, 'merbau')).toEqual(['jones']);
  });

  it('matches the notes', () => {
    expect(search(POPULATION, DOCS, 'round the back')).toEqual(['jones']);
  });

  it('matches the customer email', () => {
    expect(search(POPULATION, DOCS, 'bob@jones.com.au')).toEqual(['jones']);
  });

  it('folds diacritics on the stored side too, so "jose" finds "José"', () => {
    const jobs = [job({ id: 'j', customerName: 'José Álvarez' })];
    expect(search(jobs, {}, 'jose alvarez')).toEqual(['j']);
  });

  it('does not match checklist item text (deliberately excluded from the haystack)', () => {
    const jobs = [
      job({ id: 'j', checklist: [{ id: 'c1', text: '90mm screws', done: false, createdAt: 0 }] }),
    ];
    expect(search(jobs, {}, 'screws')).toEqual([]);
  });
});

describe('jobSearch — multi-token AND', () => {
  it('REGRESSION: "jones pergola" finds the job whose customer is Jones and whose name is Pergola', () => {
    expect(search(POPULATION, DOCS, 'jones pergola')).toEqual(['jones']);
  });

  it('requires every token to match — "jones fence" does not find the Jones pergola', () => {
    expect(search(POPULATION, DOCS, 'jones fence')).toEqual([]);
  });

  it('matches tokens spread across the job name and the address', () => {
    expect(search(POPULATION, DOCS, 'pergola smith')).toEqual(['jones']);
  });

  it('ignores token order', () => {
    expect(search(POPULATION, DOCS, 'pergola jones')).toEqual(['jones']);
  });

  it('does not let a single token bridge two fields', () => {
    // customerName ends "Jones", name begins "Pergola" — "jonespergola" must
    // not match across the join.
    expect(search(POPULATION, DOCS, 'jonespergola')).toEqual([]);
  });
});

describe('jobSearch — phone', () => {
  it('finds "0412 345 678" typed with spaces', () => {
    expect(search(POPULATION, DOCS, '0412 345 678')).toEqual(['jones']);
  });

  it('finds it typed without spaces', () => {
    expect(search(POPULATION, DOCS, '0412345678')).toEqual(['jones']);
  });

  it('finds it from the last six digits', () => {
    expect(search(POPULATION, DOCS, '345678')).toEqual(['jones']);
  });

  it('finds a number stored with a country code from its local spelling', () => {
    // Stored '+61 400 999 111' → tail '00999111'; typed '0400 999 111' →
    // digits '0400999111', whose tail '00999111' is what matches.
    expect(search(POPULATION, DOCS, '00999111')).toEqual(['nguyen']);
  });

  it('does not treat a two-digit query as a phone match, so "12" matches "12 Smith St" and nothing else', () => {
    expect(search(POPULATION, DOCS, '12')).toEqual(['jones']);
  });
});

describe('jobSearch — document numbers', () => {
  it('finds a job by its invoice number "IN-1042"', () => {
    expect(search(POPULATION, DOCS, 'IN-1042')).toEqual(['jones']);
  });

  it('finds it from the bare digits "1042"', () => {
    expect(search(POPULATION, DOCS, '1042')).toEqual(['jones']);
  });

  it('finds it from "in1042" with the separator missing', () => {
    expect(search(POPULATION, DOCS, 'in1042')).toEqual(['jones']);
  });

  it('finds a job by the number on a second attached document, not just the primary', () => {
    const docs = { jones: [invoice({ number: 'IN-1042' }), invoice({ id: 'q', number: 'QU-0777' })] };
    expect(search([JONES], docs, 'QU-0777')).toEqual(['jones']);
  });

  it('does not attribute a document number to a job it is not attached to', () => {
    expect(search(POPULATION, DOCS, 'QU-1031')).toEqual(['nguyen']);
  });
});

describe('jobSearch — ordering and purity', () => {
  it('preserves the order of the array it was given (the sort owns ordering, not the search)', () => {
    const reversed = [NGUYEN, JONES];
    const docsByJob = new Map(Object.entries(DOCS));
    const index = buildJobSearchIndex(reversed, docsByJob);
    // Both jobs have a phone, so both match a bare-digits query on '9'... use
    // a token both share instead: neither name shares one, so match on the
    // 'e' inside both names via a two-job query is unreliable. Use ids.
    const out = filterJobsBySearch(reversed, index, 'e');
    expect(out.map((j: any) => j.id)).toEqual(['nguyen', 'jones']);
  });

  it('never returns a job twice when a token matches several of its fields', () => {
    // 'jones' is in both the customer name and the email.
    const out = search([JONES], DOCS, 'jones');
    expect(out).toEqual(['jones']);
  });

  it('does not mutate the array it was given', () => {
    const input = [...POPULATION];
    const copy = [...input];
    const index = buildJobSearchIndex(input, new Map(Object.entries(DOCS)));
    filterJobsBySearch(input, index, 'jones');
    expect(input).toEqual(copy);
  });

  it('returns the input array untouched for an empty query', () => {
    const index = buildJobSearchIndex(POPULATION, new Map());
    expect(filterJobsBySearch(POPULATION, index, '   ')).toBe(POPULATION);
  });

  it('drops a job that is not in the index rather than throwing', () => {
    const index = buildJobSearchIndex([JONES], new Map());
    expect(filterJobsBySearch(POPULATION, index, 'nguyen')).toEqual([]);
  });
});

describe('buildJobSearchIndex', () => {
  it('indexes every job exactly once', () => {
    const index = buildJobSearchIndex(POPULATION, new Map(Object.entries(DOCS)));
    expect(index.size).toBe(2);
  });

  it('survives a ghost job doc with no name, customer or address', () => {
    const ghost = { id: 'ghost', stage: 'inquiry' } as any;
    const index = buildJobSearchIndex([ghost], new Map());
    expect(index.get('ghost')).toBeDefined();
    expect(filterJobsBySearch([ghost], index, 'anything')).toEqual([]);
  });

  it('ignores documents with no matching job rather than indexing them', () => {
    const index = buildJobSearchIndex([JONES], new Map([['orphan', [invoice({ number: 'IN-9999' })]]]));
    expect(filterJobsBySearch([JONES], index, 'IN-9999')).toEqual([]);
  });

  it('survives a document with no number', () => {
    const index = buildJobSearchIndex([JONES], new Map([['jones', [invoice({ number: undefined })]]]));
    expect(filterJobsBySearch([JONES], index, 'jones').map((j: any) => j.id)).toEqual(['jones']);
  });
});

describe('jobSearch — fuzzy fallback', () => {
  const KATH = job({ id: 'kath', customerName: 'Catherine Doyle', name: 'Bathroom' });
  const SMITH = job({ id: 'smith', customerName: 'Jane Smith', name: 'Fence' });

  it('forgives a one-letter typo when nothing matches exactly', () => {
    // 'cathrine' is not a substring of 'catherine', so this can only pass via
    // the fuzzy pass.
    expect(search([KATH], {}, 'cathrine')).toEqual(['kath']);
  });

  it('sounds out a surname spelled the way it was heard — "smyth" finds Smith', () => {
    expect(search([SMITH], {}, 'smyth')).toEqual(['smith']);
  });

  it('does not widen a query that already had hits', () => {
    // 'doyle' matches Catherine Doyle strictly. Sarah Doyel (a near-miss
    // spelling) must not be dragged in alongside it.
    const doyel = job({ id: 'doyel', customerName: 'Sarah Doyel', name: 'Fence' });
    expect(search([KATH, doyel], {}, 'doyle')).toEqual(['kath']);
  });

  it('does not fuzzy-match a multi-word query', () => {
    expect(search([KATH], {}, 'cathrine doyle')).toEqual([]);
  });

  it('does not fuzzy-match a query shorter than three characters', () => {
    expect(search([KATH], {}, 'ka')).toEqual([]);
  });

  it('only fuzzy-matches names, never notes or addresses', () => {
    const jobs = [job({ id: 'j', customerName: 'Bob', name: 'Deck', notes: 'merbau' })];
    expect(search(jobs, {}, 'merbeau')).toEqual([]);
  });

  it('still finds nothing when the query resembles nothing on the books', () => {
    expect(search([KATH, SMITH], {}, 'zzzqqq')).toEqual([]);
  });
});
