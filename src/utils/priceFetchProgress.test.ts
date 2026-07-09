import { describe, it, expect } from 'vitest';
import {
  initialFetchEstimateSeconds,
  reestimateFetchSeconds,
  applyPricedRow,
  mergePipelineMaterials,
  POST_BATCH_TAIL_SECONDS,
} from './priceFetchProgress';
import type { Material } from '../types';

function mat(overrides: Partial<Material>): Material {
  return {
    id: 'm1',
    name: 'thing',
    quantity: 1,
    unit: 'each',
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
    ...overrides,
  } as Material;
}

describe('initialFetchEstimateSeconds', () => {
  it('floors at one 35s chunk plus the post-batch tail', () => {
    expect(initialFetchEstimateSeconds(0)).toBe(35 + POST_BATCH_TAIL_SECONDS);
    expect(initialFetchEstimateSeconds(1)).toBe(35 + POST_BATCH_TAIL_SECONDS);
    expect(initialFetchEstimateSeconds(3)).toBe(35 + POST_BATCH_TAIL_SECONDS);
  });

  it('adds 35s per chunk of 3 items', () => {
    expect(initialFetchEstimateSeconds(4)).toBe(70 + POST_BATCH_TAIL_SECONDS);
    expect(initialFetchEstimateSeconds(9)).toBe(105 + POST_BATCH_TAIL_SECONDS);
  });
});

describe('reestimateFetchSeconds', () => {
  it('returns null before any chunk has completed (regression: chunkIndex-0 event crushed the countdown)', () => {
    expect(
      reestimateFetchSeconds({
        completedChunks: 0,
        totalChunks: 4,
        batchStartedAtMs: 0,
        nowMs: 2_000,
      }),
    ).toBeNull();
  });

  it('projects remaining chunks from the measured per-chunk average', () => {
    // 2 chunks in 60s → 30s each, 2 remaining → 60s + tail
    expect(
      reestimateFetchSeconds({
        completedChunks: 2,
        totalChunks: 4,
        batchStartedAtMs: 0,
        nowMs: 60_000,
      }),
    ).toBe(60 + POST_BATCH_TAIL_SECONDS);
  });

  it('returns the post-batch tail when all chunks are done', () => {
    expect(
      reestimateFetchSeconds({
        completedChunks: 4,
        totalChunks: 4,
        batchStartedAtMs: 0,
        nowMs: 120_000,
      }),
    ).toBe(POST_BATCH_TAIL_SECONDS);
  });

  it('never goes negative on clock skew', () => {
    expect(
      reestimateFetchSeconds({
        completedChunks: 1,
        totalChunks: 3,
        batchStartedAtMs: 10_000,
        nowMs: 9_000,
      }),
    ).toBe(POST_BATCH_TAIL_SECONDS);
  });
});

describe('applyPricedRow', () => {
  it('replaces the matching row by id and keeps the others', () => {
    const a = mat({ id: 'a', price: 0 });
    const b = mat({ id: 'b', price: 5 });
    const priced = mat({ id: 'a', price: 42.5, pricingSource: 'scraper' });
    const next = applyPricedRow([a, b], priced);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(priced);
    expect(next[1]).toBe(b);
  });

  it('does not mutate the input array', () => {
    const a = mat({ id: 'a', price: 0 });
    const input = [a];
    applyPricedRow(input, mat({ id: 'a', price: 9 }));
    expect(input[0]).toBe(a);
    expect(input[0].price).toBe(0);
  });

  it('ignores snapshots for rows that no longer exist (stale event)', () => {
    const input = [mat({ id: 'a' })];
    expect(applyPricedRow(input, mat({ id: 'deleted-row' }))).toBe(input);
  });
});

describe('mergePipelineMaterials', () => {
  it('pipeline version wins for rows it priced (carries reconcile adjustments)', () => {
    const live = [mat({ id: 'a', price: 10, quantity: 1 })];
    const pipeline = [mat({ id: 'a', price: 12.5, quantity: 3 })];
    const next = mergePipelineMaterials(live, pipeline);
    expect(next[0].price).toBe(12.5);
    expect(next[0].quantity).toBe(3);
  });

  it('keeps rows the user added mid-fetch (regression: final save dropped them)', () => {
    const live = [mat({ id: 'a' }), mat({ id: 'added-by-user', name: 'silicone' })];
    const pipeline = [mat({ id: 'a', price: 9 })];
    const next = mergePipelineMaterials(live, pipeline);
    expect(next.map((m) => m.id)).toEqual(['a', 'added-by-user']);
    expect(next[0].price).toBe(9);
  });

  it('respects rows the user deleted mid-fetch', () => {
    const live = [mat({ id: 'b' })];
    const pipeline = [mat({ id: 'a', price: 9 }), mat({ id: 'b', price: 4 })];
    const next = mergePipelineMaterials(live, pipeline);
    expect(next.map((m) => m.id)).toEqual(['b']);
  });
});
