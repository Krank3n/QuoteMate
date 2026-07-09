import { describe, it, expect } from 'vitest';
import { preserveSnapshotIdentity } from './snapshotIdentity';

type Row = { id: string; updatedAt: number; label?: string };

const idOf = (r: Row) => r.id;
const versionOf = (r: Row) => r.updatedAt;

const merge = (prev: Row[], next: Row[]) =>
  preserveSnapshotIdentity(prev, next, idOf, versionOf);

describe('preserveSnapshotIdentity', () => {
  it('returns the previous array instance when the snapshot is an identical echo', () => {
    const prev: Row[] = [
      { id: 'a', updatedAt: 100 },
      { id: 'b', updatedAt: 200 },
    ];
    // Fresh object instances, same ids + versions — a listener echo.
    const next: Row[] = [
      { id: 'a', updatedAt: 100 },
      { id: 'b', updatedAt: 200 },
    ];
    expect(merge(prev, next)).toBe(prev);
  });

  it('keeps previous instances for unchanged items when one item changes', () => {
    const a = { id: 'a', updatedAt: 100 };
    const b = { id: 'b', updatedAt: 200 };
    const prev = [a, b];
    const bChanged = { id: 'b', updatedAt: 250 };
    const result = merge(prev, [{ id: 'a', updatedAt: 100 }, bChanged]);

    expect(result).not.toBe(prev);
    expect(result[0]).toBe(a); // unchanged item keeps its identity
    expect(result[1]).toBe(bChanged); // changed item takes the new instance
  });

  it('reports a change on reorder but still reuses the old instances', () => {
    const a = { id: 'a', updatedAt: 100 };
    const b = { id: 'b', updatedAt: 200 };
    const prev = [a, b];
    const result = merge(prev, [
      { id: 'b', updatedAt: 200 },
      { id: 'a', updatedAt: 100 },
    ]);

    expect(result).not.toBe(prev);
    expect(result[0]).toBe(b);
    expect(result[1]).toBe(a);
  });

  it('returns a new array when items are added', () => {
    const a = { id: 'a', updatedAt: 100 };
    const prev = [a];
    const result = merge(prev, [
      { id: 'a', updatedAt: 100 },
      { id: 'b', updatedAt: 200 },
    ]);

    expect(result).not.toBe(prev);
    expect(result[0]).toBe(a);
    expect(result).toHaveLength(2);
  });

  it('returns a new array when items are removed', () => {
    const a = { id: 'a', updatedAt: 100 };
    const b = { id: 'b', updatedAt: 200 };
    const prev = [a, b];
    const result = merge(prev, [{ id: 'a', updatedAt: 100 }]);

    expect(result).not.toBe(prev);
    expect(result).toEqual([a]);
    expect(result[0]).toBe(a);
  });

  it('treats items with a NaN version as always changed (never reuses a stale instance)', () => {
    const a = { id: 'a', updatedAt: NaN, label: 'old' };
    const prev = [a];
    const fresh = { id: 'a', updatedAt: NaN, label: 'new' };
    const result = merge(prev, [fresh]);

    expect(result).not.toBe(prev);
    expect(result[0]).toBe(fresh);
  });

  it('handles empty previous and empty next arrays', () => {
    const empty: Row[] = [];
    expect(merge(empty, [])).toBe(empty);
    const item = { id: 'a', updatedAt: 1 };
    expect(merge(empty, [item])[0]).toBe(item);
    expect(merge([item], [])).toEqual([]);
  });
});
