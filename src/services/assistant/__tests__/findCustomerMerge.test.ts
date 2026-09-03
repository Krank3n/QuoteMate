import { describe, it, expect } from 'vitest';
import { scoreCustomerCandidates, CustomerCandidate } from '../readTools';

describe('scoreCustomerCandidates', () => {
  const candidates: CustomerCandidate[] = [
    { id: '1', name: 'Bob Smith', phone: '0412345678', email: 'bob@example.com', source: 'saved' },
    { id: '2', name: 'Bob Smith', phone: '0412345678', source: 'recent' },
    { id: '3', name: 'Robert Smith', phone: '0498765432', source: 'phone' },
    { id: '4', name: 'Alice Johnson', source: 'saved' },
  ];

  it('returns expected contract shape', () => {
    const result = scoreCustomerCandidates('Bob Smith', candidates);
    expect(result).toHaveProperty('matches');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('ambiguous');
    expect(result).toHaveProperty('needsConfirmation');
    expect(result).toHaveProperty('totalScanned');
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(typeof result.ambiguous).toBe('boolean');
    expect(typeof result.needsConfirmation).toBe('boolean');
  });

  it('finds Bob Smith as top match', () => {
    const result = scoreCustomerCandidates('Bob Smith', candidates);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].name.toLowerCase()).toContain('bob');
  });

  it('each match has required fields', () => {
    const result = scoreCustomerCandidates('Bob Smith', candidates);
    for (const m of result.matches) {
      expect(m).toHaveProperty('contactId');
      expect(m).toHaveProperty('name');
      expect(m).toHaveProperty('hasEmail');
      expect(m).toHaveProperty('matchType');
      expect(m).toHaveProperty('confidence');
      expect(['phone', 'exact', 'close', 'fuzzy', 'sounds_like']).toContain(m.matchType);
    }
  });

  it('exact match sets needsConfirmation false', () => {
    const result = scoreCustomerCandidates('Bob Smith', [
      { id: '1', name: 'Bob Smith', source: 'saved' },
    ]);
    expect(result.needsConfirmation).toBe(false);
  });

  it('respects totalScanned count', () => {
    const result = scoreCustomerCandidates('Bob', candidates);
    expect(result.totalScanned).toBe(candidates.length);
  });
});

// A phone-book or recent-quote hit is not a saved contact: its contactId is a
// throwaway, and every Apply on one failed with "Couldn't find that contact".
// The match now says where it came from and carries a draft to save instead.
describe('scoreCustomerCandidates — where a match lives', () => {
  const candidates: CustomerCandidate[] = [
    { id: 'saved-1', name: 'Bob Smith', phone: '0412345678', email: 'bob@example.com', source: 'saved' },
    { id: 'doc-9', name: 'Sue Williamson', phone: '0428753564', source: 'recent' },
    { id: 'tmp-3', name: 'Diane Bunk', phone: '0477535423', email: 'di@example.com', source: 'phone' },
  ];

  it('a saved contact carries its id and no draft', () => {
    const [m] = scoreCustomerCandidates('Bob Smith', candidates).matches;
    expect(m.source).toBe('saved');
    expect(m.contactId).toBe('saved-1');
    expect(m.draft).toBeUndefined();
  });

  it('a phone-book hit carries a draft with the details the picker saw', () => {
    const [m] = scoreCustomerCandidates('Diane Bunk', candidates).matches;
    expect(m.source).toBe('phone');
    expect(m.draft).toEqual({ name: 'Diane Bunk', phone: '0477535423', email: 'di@example.com' });
  });

  it('a recent-quote customer carries a draft too, without inventing an email', () => {
    const [m] = scoreCustomerCandidates('Sue Williamson', candidates).matches;
    expect(m.source).toBe('recent');
    expect(m.draft).toEqual({ name: 'Sue Williamson', phone: '0428753564' });
  });
});
