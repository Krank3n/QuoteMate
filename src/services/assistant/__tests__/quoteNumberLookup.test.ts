/**
 * Mate lost a quote id three times in one conversation (4 Sep 2026) and twice
 * asked the tradie to read out the QU number — a move the prompt calls the last
 * resort, and one that could not work: the number is a customer-facing label
 * and every tool takes the Firestore id. The tradie looked it up, read it out,
 * and Mate still couldn't act.
 */
import { describe, expect, it } from 'vitest';
import {
  looksLikeDocumentNumber,
  missingQuoteMessage,
  resolveDocumentNumber,
  unresolvedNumberMessage,
} from '../quoteNumberLookup';

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

describe('what a miss tells Mate', () => {
  const rows = [
    { id: 'doc-a', number: 'QU-001', jobName: 'Eaves replacement', customerName: 'Dave Loew' },
    { id: 'doc-b', number: 'QU-002', jobName: 'Deck stain', customerName: 'Katie Ross' },
  ];

  it('names the recent documents so Mate can pick one itself', () => {
    const msg = missingQuoteMessage('prop_9f2', rows);
    expect(msg).toContain('doc-a');
    expect(msg).toContain('Eaves replacement');
    expect(msg).toContain('Dave Loew');
  });

  it('lists at most five, so a long history cannot bury the instruction', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `doc-${i}`, number: `QU-${i}` }));
    const msg = missingQuoteMessage('nope', many);
    expect(msg).toContain('doc-4');
    expect(msg).not.toContain('doc-5');
  });

  it('fills the blanks rather than printing undefined at a tradie', () => {
    expect(missingQuoteMessage('nope', [{ id: 'doc-x' }])).toContain('doc-x (no number — unnamed job for unnamed customer)');
  });

  it('says plainly when there is nothing to offer', () => {
    expect(missingQuoteMessage('nope', [])).toContain('no recent quotes on this account');
  });

  it('every miss message forbids the ask that started this', () => {
    expect(missingQuoteMessage('nope', rows)).toContain('do NOT ask them to read you a quote number');
    expect(missingQuoteMessage('nope', [])).not.toContain('read you a quote number');
    expect(unresolvedNumberMessage('QU-999')).toContain('Do NOT ask the tradie for a number');
  });

  it('explains what a number is when one resolves to nothing', () => {
    const msg = unresolvedNumberMessage('QU-999');
    expect(msg).toContain('QU-999');
    expect(msg).toContain('not a document id');
    expect(msg).toContain('list_recent_quotes');
  });
});
