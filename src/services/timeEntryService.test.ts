import { describe, it, expect } from 'vitest';
import { assertStorableEntry, normaliseTimeEntry } from './timeEntryService';

describe('time entry records', () => {
  it('normalises a raw Firestore doc, defaulting billable on and the worker to the owner', () => {
    const e = normaliseTimeEntry({ userId: 'u1', jobId: 'j1', date: '2026-09-30', hours: '7.5' }, 'e1');
    expect(e).toMatchObject({ id: 'e1', userId: 'u1', jobId: 'j1', hours: 7.5, workerId: 'u1', billable: true, source: 'manual' });
  });

  it('keeps billable:false and the mate source', () => {
    const e = normaliseTimeEntry({ jobId: 'j1', hours: 2, billable: false, source: 'mate' }, 'e2');
    expect(e.billable).toBe(false);
    expect(e.source).toBe('mate');
  });

  it('turns unreadable hours into 0 so sums skip them', () => {
    expect(normaliseTimeEntry({ hours: 'lots' }, 'e3').hours).toBe(0);
  });

  it('refuses to store an entry with no job, a bad date or bad hours', () => {
    expect(() => assertStorableEntry({ jobId: '', date: '2026-09-30', hours: 2 })).toThrow(/job/);
    expect(() => assertStorableEntry({ jobId: 'j', date: '2026-13-01', hours: 2 })).toThrow(/date/);
    expect(() => assertStorableEntry({ jobId: 'j', date: '2026-09-30', hours: 30 })).toThrow(/24/);
    expect(() => assertStorableEntry({ jobId: 'j', date: '2026-09-30', hours: 8 })).not.toThrow();
  });
});
