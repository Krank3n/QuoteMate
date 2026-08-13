/**
 * The bug this exists to stop: pull-to-refresh loaded every job (loadJobs is
 * unbounded), then the next listener echo — fired by any write, including the
 * server's own aggregate trigger — replaced the array with the capped snapshot
 * and the tail vanished mid-session. Rows and chip counts dropped while the
 * user watched.
 *
 * The hard part is the other direction: a merge that always appends would keep
 * a job that was deleted on another device forever. Hence the `wasTruncated`
 * gate, which these pin from both sides.
 */
import { describe, it, expect } from 'vitest';

import { mergeTruncatedSnapshot } from './mergeTruncatedSnapshot';

type Row = { id: string; n?: number };
const idOf = (r: Row) => r.id;
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe('mergeTruncatedSnapshot — truncated snapshot', () => {
  it('keeps jobs the unbounded loader fetched when the listener snapshot is truncated at the cap', () => {
    const prev = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const next = [{ id: 'a' }, { id: 'b' }];
    expect(ids(mergeTruncatedSnapshot(prev, next, idOf, true))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('REGRESSION: a pull-to-refresh followed by a listener echo no longer drops the tail', () => {
    const refreshed: Row[] = Array.from({ length: 130 }, (_, i) => ({ id: `job${i}` }));
    const echo = refreshed.slice(0, 100);
    const merged = mergeTruncatedSnapshot(refreshed, echo, idOf, true);
    expect(merged).toHaveLength(130);
  });

  it('puts the snapshot first so the freshest rows keep the query order', () => {
    const prev = [{ id: 'old' }, { id: 'b' }];
    const next = [{ id: 'b' }, { id: 'new' }];
    expect(ids(mergeTruncatedSnapshot(prev, next, idOf, true))).toEqual(['b', 'new', 'old']);
  });

  it('prefers the snapshot copy of a row the previous array also held, so edits still land', () => {
    const prev = [{ id: 'a', n: 1 }, { id: 'z', n: 9 }];
    const next = [{ id: 'a', n: 2 }];
    const merged = mergeTruncatedSnapshot(prev, next, idOf, true);
    expect(merged.find((r) => r.id === 'a')!.n).toBe(2);
  });

  it('never returns a row twice', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    const next = [{ id: 'a' }, { id: 'b' }];
    const merged = mergeTruncatedSnapshot(prev, next, idOf, true);
    expect(new Set(ids(merged)).size).toBe(merged.length);
  });

  it('returns the snapshot itself when there is nothing extra to carry', () => {
    const prev = [{ id: 'a' }];
    const next = [{ id: 'a' }, { id: 'b' }];
    expect(mergeTruncatedSnapshot(prev, next, idOf, true)).toBe(next);
  });

  it('returns the snapshot itself on a cold start with nothing cached', () => {
    const next = [{ id: 'a' }];
    expect(mergeTruncatedSnapshot([], next, idOf, true)).toBe(next);
  });
});

describe('mergeTruncatedSnapshot — complete snapshot', () => {
  it('lets a delete through when the snapshot is under the cap (the snapshot is authoritative)', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    const next = [{ id: 'a' }];
    expect(ids(mergeTruncatedSnapshot(prev, next, idOf, false))).toEqual(['a']);
  });

  it('lets the last row be deleted, leaving an empty list rather than a ghost', () => {
    expect(mergeTruncatedSnapshot([{ id: 'a' }], [], idOf, false)).toEqual([]);
  });

  it('returns the snapshot array identity untouched so downstream identity checks still work', () => {
    const prev = [{ id: 'a' }];
    const next = [{ id: 'a' }, { id: 'b' }];
    expect(mergeTruncatedSnapshot(prev, next, idOf, false)).toBe(next);
  });
});

describe('mergeTruncatedSnapshot — purity', () => {
  it('does not mutate either array it was given (the store owns those arrays)', () => {
    const prev = [{ id: 'a' }, { id: 'z' }];
    const next = [{ id: 'a' }];
    const prevCopy = [...prev];
    const nextCopy = [...next];
    mergeTruncatedSnapshot(prev, next, idOf, true);
    expect(prev).toEqual(prevCopy);
    expect(next).toEqual(nextCopy);
  });
});
