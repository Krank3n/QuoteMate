import { describe, it, expect } from 'vitest';
import {
  buildMaterialsRecommendPatch,
  buildPriceFetchPatch,
  clampCount,
} from './featureUsage';

describe('buildMaterialsRecommendPatch — recommend-run counters', () => {
  it('recommend success increments calls+latency only', () => {
    const patch = buildMaterialsRecommendPatch(true, 1234);
    expect(patch).toEqual({
      materialsRecommendCalls: 1,
      materialsRecommendFailures: 0,
      materialsRecommendLatencyMsSum: 1234,
    });
  });

  it('recommend failure increments failures', () => {
    const patch = buildMaterialsRecommendPatch(false, 500);
    expect(patch.materialsRecommendCalls).toBe(1);
    expect(patch.materialsRecommendFailures).toBe(1);
    expect(patch.materialsRecommendLatencyMsSum).toBe(500);
  });

  it('floors fractional latency and clamps negative/NaN latency to 0', () => {
    expect(buildMaterialsRecommendPatch(true, 12.9).materialsRecommendLatencyMsSum).toBe(12);
    expect(buildMaterialsRecommendPatch(true, -5).materialsRecommendLatencyMsSum).toBe(0);
    expect(buildMaterialsRecommendPatch(true, NaN).materialsRecommendLatencyMsSum).toBe(0);
  });
});

describe('clampCount / buildPriceFetchPatch — price-fetch counters', () => {
  it('price-fetch counts clamped 0..10000', () => {
    expect(clampCount(50)).toBe(50);
    expect(clampCount(10000)).toBe(10000);
    expect(clampCount(10001)).toBe(10000);
    expect(clampCount(999999)).toBe(10000);
    const patch = buildPriceFetchPatch({ fetched: 10001, failed: 3, skipped: 2, cancelled: false });
    expect(patch.priceFetchItemsFetched).toBe(10000);
    expect(patch.priceFetchItemsFailed).toBe(3);
    expect(patch.priceFetchItemsSkipped).toBe(2);
    expect(patch.priceFetchRuns).toBe(1);
    expect(patch.priceFetchRunsCancelled).toBe(0);
  });

  it('negative/NaN counts clamped to 0', () => {
    expect(clampCount(-1)).toBe(0);
    expect(clampCount(NaN)).toBe(0);
    expect(clampCount(undefined)).toBe(0);
    expect(clampCount('nope')).toBe(0);
    const patch = buildPriceFetchPatch({
      fetched: -10,
      failed: NaN as unknown as number,
      skipped: undefined,
      cancelled: false,
    });
    expect(patch.priceFetchItemsFetched).toBe(0);
    expect(patch.priceFetchItemsFailed).toBe(0);
    expect(patch.priceFetchItemsSkipped).toBe(0);
  });

  it('bySource fields map correctly', () => {
    const patch = buildPriceFetchPatch({
      fetched: 4,
      failed: 0,
      skipped: 0,
      cancelled: true,
      bySource: { bunnings: 2, reece: 1, websearch: 1, local: 0 },
    });
    expect(patch['priceFetchBySource.bunnings']).toBe(2);
    expect(patch['priceFetchBySource.reece']).toBe(1);
    expect(patch['priceFetchBySource.websearch']).toBe(1);
    expect(patch['priceFetchBySource.local']).toBe(0);
    expect(patch.priceFetchRunsCancelled).toBe(1);
  });

  it('defaults missing bySource buckets to 0', () => {
    const patch = buildPriceFetchPatch({ fetched: 1, failed: 0, skipped: 0, cancelled: false });
    expect(patch['priceFetchBySource.bunnings']).toBe(0);
    expect(patch['priceFetchBySource.reece']).toBe(0);
    expect(patch['priceFetchBySource.websearch']).toBe(0);
    expect(patch['priceFetchBySource.local']).toBe(0);
  });
});
