import { describe, it, expect, vi } from 'vitest';
import { applyJobAggregatePatch } from './jobHandlers';

/**
 * Regression tests for the July 2026 ghost-job bug: syncJobAggregates used
 * set({merge: true}) for its final write, so when the client deleted or
 * re-keyed a Job between the trigger's read and write, the merge recreated
 * the deleted doc as a stage-less "ghost" holding only aggregates. JobCard
 * then crashed the app on every open. The write is now an update() that
 * treats NOT_FOUND as "job gone, skip".
 */
describe('applyJobAggregatePatch', () => {
  it('applies the patch via update (never a doc-creating write)', async () => {
    const update = vi.fn(async () => undefined);
    const onMissing = vi.fn();
    await applyJobAggregatePatch({ update }, { totalQuoted: 100 }, onMissing);
    expect(update).toHaveBeenCalledWith({ totalQuoted: 100 });
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('skips (no throw, no recreate) when the job was deleted mid-flight', async () => {
    const update = vi.fn(async () => {
      const err = new Error('NOT_FOUND: no document to update') as Error & { code: number };
      err.code = 5;
      throw err;
    });
    const onMissing = vi.fn();
    await expect(
      applyJobAggregatePatch({ update }, { totalQuoted: 0 }, onMissing),
    ).resolves.toBeUndefined();
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-NOT_FOUND errors', async () => {
    const update = vi.fn(async () => {
      const err = new Error('PERMISSION_DENIED') as Error & { code: number };
      err.code = 7;
      throw err;
    });
    await expect(
      applyJobAggregatePatch({ update }, {}, () => {}),
    ).rejects.toThrow('PERMISSION_DENIED');
  });
});
