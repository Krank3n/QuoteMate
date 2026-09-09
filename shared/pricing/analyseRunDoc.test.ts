/**
 * The analyse-handoff verdict — the rules a phone applies to the server's
 * parked copy of a materials run.
 *
 * Written against the 7 Sep 2026 failure: the analyse finished 200 after
 * close to two minutes, but the app had been suspended and
 * the phone only raised "Network request failed" 234 s after sending. The
 * elapsed clock therefore starts at the REQUEST, not at the wait, and a
 * finished result must still be handed over that late.
 */
import { describe, it, expect } from 'vitest';
import {
  HANDOFF_DEADLINE_MS,
  HANDOFF_GRACE_MS,
  isValidAnalyseRequestId,
  readAnalyseHandoff,
  type AnalyseRunRecord,
} from './analyseRunDoc';

/** The common case: the phone has just started looking, N ms after sending. */
const at = (sinceSentMs: number, sinceWaitMs = 0) => ({ sinceSentMs, sinceWaitMs });

const done: AnalyseRunRecord = {
  status: 'done',
  startedAt: '2026-09-07T10:00:00.000Z',
  finishedAt: '2026-09-07T10:02:00.000Z',
  result: { materials: [{ name: 'Dulux Wash & Wear 10L' }], estimatedHours: 40 },
};

describe('readAnalyseHandoff', () => {
  it('hands over a finished result 234 s after the request — the case it exists for', () => {
    expect(readAnalyseHandoff(done, at(234_000))).toEqual({ kind: 'done', result: done.result });
  });

  it('hands over a finished result even past the deadline', () => {
    expect(readAnalyseHandoff(done, at(HANDOFF_DEADLINE_MS + 60_000)).kind).toBe('done');
  });

  it('surfaces the server error when the run genuinely failed', () => {
    const record: AnalyseRunRecord = { status: 'failed', error: 'No LLM API keys configured', startedAt: 'x' };
    expect(readAnalyseHandoff(record, at(5_000))).toEqual({ kind: 'failed', error: 'No LLM API keys configured' });
  });

  it('waits while the run is still going', () => {
    const record: AnalyseRunRecord = { status: 'running', startedAt: 'x' };
    expect(readAnalyseHandoff(record, at(100_000))).toEqual({ kind: 'wait' });
  });

  it('judges an absent document on how long THIS phone has been looking, not on the send clock', () => {
    // Woke up four minutes after sending, just started looking: the window
    // has not run. On the send clock alone it was already long over — which
    // is why a late wake-up used to give up on its very first read.
    expect(readAnalyseHandoff(null, at(234_000, 0))).toEqual({ kind: 'wait' });
    expect(readAnalyseHandoff(null, at(234_000, HANDOFF_GRACE_MS - 1))).toEqual({ kind: 'wait' });
  });

  it('gives up once no document has appeared within the grace period of looking — the request never landed', () => {
    const verdict = readAnalyseHandoff(null, at(30_000, HANDOFF_GRACE_MS));
    expect(verdict).toEqual({ kind: 'give-up', reason: 'the analyse never reached the server' });
  });

  it('gives up on a run still marked running past the function timeout', () => {
    const record: AnalyseRunRecord = { status: 'running', startedAt: 'x' };
    expect(readAnalyseHandoff(record, at(HANDOFF_DEADLINE_MS))).toEqual({
      kind: 'give-up',
      reason: 'the analyse ran out of time',
    });
  });

  it('gives up at once on a done record with no result — the server could not park it', () => {
    // The server writes this marker when the payload write itself failed.
    // Waiting out the deadline here would make that failure SLOWER than the
    // pre-fix code, which surfaced it instantly.
    const record: AnalyseRunRecord = { status: 'done', startedAt: 'x' };
    expect(readAnalyseHandoff(record, at(1_000))).toEqual({
      kind: 'give-up',
      reason: 'the result could not be parked',
    });
  });
});

describe('isValidAnalyseRequestId', () => {
  it('accepts the ids generateId mints', () => {
    expect(isValidAnalyseRequestId('1700000000000-k3x9f2abc')).toBe(true);
  });

  it('rejects anything that would escape the document path', () => {
    for (const bad of ['', '.', '..', 'a/b', 'users/u1/documents/q1', 'x'.repeat(129), 42, null, undefined]) {
      expect(isValidAnalyseRequestId(bad)).toBe(false);
    }
  });
});
