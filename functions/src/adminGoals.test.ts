import { describe, it, expect } from 'vitest';
import { sanitizeGoals, MAX_GOALS } from './adminGoals.helpers';

describe('sanitizeGoals', () => {
  it('keeps valid goals and sorts them by deadline', () => {
    const out = sanitizeGoals([
      { id: 'b', metric: 'payers', target: 100, by: '2027-06' },
      { id: 'a', metric: 'mrr', target: 5000, by: '2027-01' },
    ]);
    expect(out.map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('drops malformed rows without failing the rest', () => {
    const out = sanitizeGoals([
      { id: 'ok', metric: 'mrr', target: 1000, by: '2027-03' },
      { id: 'badMetric', metric: 'arr', target: 1000, by: '2027-03' },
      { id: 'badMonth', metric: 'mrr', target: 1000, by: '2027-13' },
      { id: 'zero', metric: 'mrr', target: 0, by: '2027-03' },
      { id: 'str', metric: 'mrr', target: '1000', by: '2027-03' },
      { id: 'ok', metric: 'mrr', target: 2000, by: '2027-04' },
      null,
      'nope',
    ]);
    expect(out).toEqual([{ id: 'ok', metric: 'mrr', target: 1000, by: '2027-03' }]);
  });

  it('strips unknown fields', () => {
    const [g] = sanitizeGoals([{ id: 'x', metric: 'mrr', target: 1, by: '2027-01', evil: true }]);
    expect(Object.keys(g).sort()).toEqual(['by', 'id', 'metric', 'target']);
  });

  it('returns [] for non-arrays and caps the list', () => {
    expect(sanitizeGoals(undefined)).toEqual([]);
    expect(sanitizeGoals({})).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `g${i}`, metric: 'mrr', target: 1, by: '2027-01' }));
    expect(sanitizeGoals(many)).toHaveLength(MAX_GOALS);
  });
});
