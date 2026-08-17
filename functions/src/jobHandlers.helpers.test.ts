import { describe, it, expect, vi } from 'vitest';
import { applyJobAggregatePatch, deriveJobStageBump } from './jobHandlers';
import type { JobDocument } from './shared/job/types';

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

/**
 * Regression tests for the Aug 2026 stuck-Paid bug, reproduced on a 1.53
 * build: record a full payment, then remove it from the payment history.
 * saveDocumentWithLedger correctly re-derived the DOCUMENT back to
 * invoice_sent / draft, but the forward-only cascade left the JOB at `paid`.
 * The card then read "Paid 3 minutes ago" beside an "Unpaid" chip and a green
 * Paid pill, and bucketForJob filed the job under Done — so an invoice still
 * owing $972.40 was invisible to the Owed filter.
 *
 * `paid` is the only stage allowed to move backwards. Manual progressions
 * stay put, because they say nothing about money.
 */
describe('deriveJobStageBump', () => {
  const doc = (stage: JobDocument['stage'], id = 'd1'): JobDocument =>
    ({ id, type: 'invoice', stage, total: 972.4, paidTotal: 0, balanceDue: 972.4 } as JobDocument);

  it('walks a paid job back to in_progress when its invoice is unpaid again', () => {
    expect(deriveJobStageBump('paid', [doc('invoice_sent')])).toBe('in_progress');
  });

  it('walks a paid job back when the payment was only partly removed', () => {
    expect(deriveJobStageBump('paid', [doc('partially_paid')])).toBe('in_progress');
  });

  it('falls back to completed when the invoice was un-sent as well as un-paid', () => {
    // The exact reproduction: an invoice that was never sent, paid, then
    // un-paid, drops to `draft` — which supports no rung on the ladder.
    expect(deriveJobStageBump('paid', [doc('draft')])).toBe('completed');
  });

  it('leaves a genuinely paid job alone', () => {
    expect(deriveJobStageBump('paid', [doc('paid')])).toBeNull();
  });

  it('keeps a paid job paid while ANY attached invoice is still paid', () => {
    expect(
      deriveJobStageBump('paid', [doc('paid', 'a'), doc('invoice_sent', 'b')]),
    ).toBeNull();
  });

  it('ignores cancelled documents when deciding to walk back', () => {
    expect(
      deriveJobStageBump('paid', [doc('cancelled', 'a'), doc('invoice_sent', 'b')]),
    ).toBe('in_progress');
  });

  it('never touches a closed or cancelled job', () => {
    expect(deriveJobStageBump('closed', [doc('invoice_sent')])).toBeNull();
    expect(deriveJobStageBump('cancelled', [doc('invoice_sent')])).toBeNull();
  });

  it('still refuses to drag a manual in_progress backwards', () => {
    // Only `paid` reverses. A tradie who pushed the job to in_progress keeps
    // it even though the docs alone would only justify `quoted`.
    expect(deriveJobStageBump('in_progress', [doc('quote_sent')])).toBeNull();
  });

  it('still cascades forward normally', () => {
    expect(deriveJobStageBump('inquiry', [doc('quote_sent')])).toBe('quoted');
    expect(deriveJobStageBump('quoted', [doc('quote_accepted')])).toBe('accepted');
    expect(deriveJobStageBump('accepted', [doc('paid')])).toBe('paid');
  });

  it('does nothing when the job has no live documents', () => {
    expect(deriveJobStageBump('paid', [])).toBeNull();
    expect(deriveJobStageBump('paid', [doc('cancelled')])).toBeNull();
  });
});
