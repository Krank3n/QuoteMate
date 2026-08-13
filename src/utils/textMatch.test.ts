/**
 * These rules used to live privately inside readTools.ts with no direct tests
 * — the only coverage was five cases on scoreCustomerCandidates, none of them
 * touching diacritics, punctuation or country codes. They are now shared with
 * the jobs-list search, so the folding itself is pinned here: if a fold
 * changes, a customer stops being findable, and that is the kind of bug that
 * survives for a year because both copies look right at a glance.
 */
import { describe, it, expect } from 'vitest';

import {
  fold,
  normalizeDigits,
  normalizePhoneTail,
  stripDiacritics,
  stripNonAlnum,
  tokenize,
} from './textMatch';

describe('stripDiacritics / fold', () => {
  it('folds diacritics so "José" and "Jose" are the same string', () => {
    expect(fold('José')).toBe(fold('Jose'));
    expect(fold('José')).toBe('jose');
  });

  it('folds a whole accented name, not just the first mark', () => {
    expect(fold('Renée Zoë Ångström')).toBe('renee zoe angstrom');
  });

  it('lowercases so case never decides a match', () => {
    expect(fold('JONES')).toBe(fold('jones'));
  });

  it('leaves unaccented text untouched apart from case', () => {
    expect(stripDiacritics('Jones')).toBe('Jones');
  });
});

describe('tokenize', () => {
  it('tokenizes on whitespace, apostrophes and hyphens so "O\'Brien-Smith" yields three tokens', () => {
    expect(tokenize("O'Brien-Smith")).toEqual(['o', 'brien', 'smith']);
  });

  it('strips punctuation rather than turning it into a token', () => {
    expect(tokenize('Smith, Jane (urgent!)')).toEqual(['smith', 'jane', 'urgent']);
  });

  it('collapses a run of whitespace instead of emitting empty tokens', () => {
    expect(tokenize('  jane   smith  ')).toEqual(['jane', 'smith']);
  });

  it('folds diacritics before splitting', () => {
    expect(tokenize('José Ángel')).toEqual(['jose', 'angel']);
  });

  it('keeps digits, so a street number survives tokenizing', () => {
    expect(tokenize('12 Smith St')).toEqual(['12', 'smith', 'st']);
  });

  it('returns nothing for an empty string', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('normalizeDigits', () => {
  it('keeps only digits, whatever the number was punctuated with', () => {
    expect(normalizeDigits('(04) 1234-5678')).toBe('0412345678');
  });

  it('returns an empty string when there are no digits at all', () => {
    expect(normalizeDigits('no digits here')).toBe('');
  });
});

describe('normalizePhoneTail', () => {
  it('reduces a phone number to its last eight digits, ignoring a country code', () => {
    expect(normalizePhoneTail('+61 412 345 678')).toBe('12345678');
  });

  it('reduces the local form to the same eight digits, so both spellings match', () => {
    expect(normalizePhoneTail('0412 345 678')).toBe(normalizePhoneTail('+61 412 345 678'));
  });

  it('treats a spaced and an unspaced number as identical', () => {
    expect(normalizePhoneTail('0412 345 678')).toBe(normalizePhoneTail('0412345678'));
  });

  it('leaves a short number alone rather than padding it', () => {
    expect(normalizePhoneTail('1234')).toBe('1234');
  });
});

describe('stripNonAlnum', () => {
  it('turns a document number into its separator-free form', () => {
    expect(stripNonAlnum('IN-1042')).toBe('in1042');
  });

  it('matches whether or not the separator was typed', () => {
    expect(stripNonAlnum('in1042')).toBe(stripNonAlnum('IN-1042'));
  });

  it('drops spaces too, so "QU 1031" folds to "qu1031"', () => {
    expect(stripNonAlnum('QU 1031')).toBe('qu1031');
  });
});
