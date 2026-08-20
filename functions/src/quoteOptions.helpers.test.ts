/**
 * The Firestore wiring behind "accepting one option cancels the others".
 *
 * This runs unattended, on the customer's tap, against documents the tradie is
 * not looking at — so the cases that matter most are the ones where it must
 * write NOTHING.
 */
import { describe, it, expect, vi } from 'vitest';

import { supersedeSiblingQuotes, type SupersedeDeps } from './quoteOptions.helpers';

const SERVER_TS = { __sentinel: 'serverTimestamp' };

function deps(rows: Array<{ id: string; [k: string]: any }>) {
  const updates: Array<{ id: string; data: any }> = [];
  const commit = vi.fn(async () => {});
  const where = vi.fn((field: string, _op: string, value: any) => ({
    get: async () => ({
      docs: rows
        .filter((r) => r[field] === value)
        .map((r) => ({ id: r.id, data: () => r })),
    }),
  }));
  const d: SupersedeDeps = {
    quotes: {
      where,
      doc: (id: string) => ({ __ref: id }),
    } as any,
    batch: () => ({
      update: (ref: any, data: any) => updates.push({ id: ref.__ref, data }),
      commit,
    }),
    now: () => SERVER_TS,
  };
  return { deps: d, updates, commit, where };
}

const accepted = { id: 'opt-1', jobId: 'job-1', status: 'accepted' };

describe('supersedeSiblingQuotes', () => {
  it('cancels the job’s other quotes in one batch', async () => {
    const { deps: d, updates, commit } = deps([
      accepted,
      { id: 'opt-2', jobId: 'job-1', status: 'sent' },
      { id: 'opt-3', jobId: 'job-1', status: 'draft' },
    ]);

    const result = await supersedeSiblingQuotes(d, 'opt-1', accepted);

    expect(result.superseded).toEqual(['opt-2', 'opt-3']);
    expect(updates.map((u) => u.id)).toEqual(['opt-2', 'opt-3']);
    expect(updates[0].data).toEqual({ status: 'cancelled', updatedAt: SERVER_TS });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('queries only this job — never the whole account', async () => {
    const { deps: d, where } = deps([accepted]);

    await supersedeSiblingQuotes(d, 'opt-1', accepted);

    expect(where).toHaveBeenCalledWith('jobId', '==', 'job-1');
  });

  it('writes nothing when the job has a single quote', async () => {
    const { deps: d, updates, commit } = deps([accepted]);

    const result = await supersedeSiblingQuotes(d, 'opt-1', accepted);

    expect(result).toEqual({ superseded: [], skipped: 'none-to-supersede' });
    expect(updates).toEqual([]);
    // A no-op must not open a batch — an empty commit is a pointless write.
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not even query when the accepted quote has no job', async () => {
    const { deps: d, where, commit } = deps([accepted]);

    const result = await supersedeSiblingQuotes(d, 'opt-1', { status: 'accepted' });

    expect(result).toEqual({ superseded: [], skipped: 'no-job' });
    expect(where).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('never cancels the accepted quote itself', async () => {
    const { deps: d, updates } = deps([accepted, { id: 'opt-2', jobId: 'job-1', status: 'sent' }]);

    await supersedeSiblingQuotes(d, 'opt-1', accepted);

    expect(updates.map((u) => u.id)).not.toContain('opt-1');
  });

  it('leaves a sibling with a deposit paid on it alone', async () => {
    const { deps: d, updates, commit } = deps([
      accepted,
      { id: 'opt-2', jobId: 'job-1', status: 'sent', depositPaid: 500 },
    ]);

    const result = await supersedeSiblingQuotes(d, 'opt-1', accepted);

    expect(result.superseded).toEqual([]);
    expect(updates).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
  });

  it('skips siblings already cancelled, so a re-accept is idempotent', async () => {
    const { deps: d, updates } = deps([
      accepted,
      { id: 'opt-2', jobId: 'job-1', status: 'cancelled' },
      { id: 'opt-3', jobId: 'job-1', status: 'sent' },
    ]);

    await supersedeSiblingQuotes(d, 'opt-1', accepted);

    expect(updates.map((u) => u.id)).toEqual(['opt-3']);
  });

  it('propagates a real Firestore failure to the caller', async () => {
    // The accept site swallows this on purpose; the helper must not hide it,
    // or the log line would claim success on a failed write.
    const { deps: d } = deps([accepted, { id: 'opt-2', jobId: 'job-1', status: 'sent' }]);
    d.batch = () => ({
      update: () => {},
      commit: async () => { throw new Error('PERMISSION_DENIED'); },
    });

    await expect(supersedeSiblingQuotes(d, 'opt-1', accepted))
      .rejects.toThrow('PERMISSION_DENIED');
  });
});
