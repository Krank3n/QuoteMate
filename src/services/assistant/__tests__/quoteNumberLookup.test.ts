/**
 * Mate lost a quote id three times in one conversation (4 Sep 2026) and twice
 * asked the tradie to read out the QU number — a move the prompt calls the last
 * resort, and one that could not work: the number is a customer-facing label
 * and every tool takes the Firestore id. The tradie looked it up, read it out,
 * and Mate still couldn't act.
 */
import { describe, expect, it } from 'vitest';
import { looksLikeDocumentNumber, resolveDocumentNumber } from '../quoteNumberLookup';

describe('looksLikeDocumentNumber', () => {
  it('recognises the numbers printed on documents, however they are typed', () => {
    for (const n of ['QU-001', 'qu-1042', 'Q-001', 'Q001', 'INV-12', 'IN 12', 'RP-002', 'inv_7']) {
      expect(looksLikeDocumentNumber(n), n).toBe(true);
    }
  });

  it('leaves real document ids alone', () => {
    for (const id of ['q-eaves-1', 'AbC123XyZ456', 'prop_9f2', '', undefined, null, 'quote']) {
      expect(looksLikeDocumentNumber(id as string), String(id)).toBe(false);
    }
  });
});

describe('resolveDocumentNumber', () => {
  const rows = [
    { id: 'doc-a', number: 'QU-001' },
    { id: 'doc-b', number: 'QU-002' },
    { id: 'doc-c' },
  ];

  it('finds the id behind a number the tradie read out', () => {
    expect(resolveDocumentNumber(rows, 'QU-001')).toBe('doc-a');
  });

  it('ignores case and punctuation, because a number arrives spoken', () => {
    expect(resolveDocumentNumber(rows, 'qu 001')).toBe('doc-a');
    expect(resolveDocumentNumber(rows, 'QU001')).toBe('doc-a');
  });

  it('refuses to guess when two series share a number', () => {
    const clashing = [
      { id: 'quote-1', number: 'Q-001' },
      { id: 'invoice-1', number: 'Q-001' },
    ];
    expect(resolveDocumentNumber(clashing, 'Q-001')).toBeUndefined();
  });

  it('returns nothing for an unknown number or an empty ask', () => {
    expect(resolveDocumentNumber(rows, 'QU-999')).toBeUndefined();
    expect(resolveDocumentNumber(rows, '')).toBeUndefined();
    expect(resolveDocumentNumber([], 'QU-001')).toBeUndefined();
  });

  it('skips rows with no number rather than matching them to an empty key', () => {
    expect(resolveDocumentNumber(rows, '-')).toBeUndefined();
  });
});
