/**
 * The analyse-handoff verdict — the rules a phone applies to the server's
 * parked copy of a materials run.
 *
 * Written against the 7 Sep 2026 failure (quote 1788778288262-9vrghsoj6):
 * the analyse finished 200 after 108.8 s, but the app had been suspended and
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

const done: AnalyseRunRecord = {
  status: 'done',
  startedAt: '2026-09-07T10:51:31.000Z',
  finishedAt: '2026-09-07T10:53:20.000Z',
  result: { materials: [{ name: 'Dulux Wash & Wear 10L' }], estimatedHours: 40 },
};

describe('readAnalyseHandoff', () => {
  it('hands over a finished result 234 s after the request — the case it exists for', () => {
    expect(readAnalyseHandoff(done, 234_000)).toEqual({ kind: 'done', result: done.result });
  });

  it('hands over a finished result even past the deadline', () => {
    expect(readAnalyseHandoff(done, HANDOFF_DEADLINE_MS + 60_000).kind).toBe('done');
  });

  it('surfaces the server error when the run genuinely failed', () => {
    const record: AnalyseRunRecord = { status: 'failed', error: 'No LLM API keys configured', startedAt: 'x' };
    expect(readAnalyseHandoff(record, 5_000)).toEqual({ kind: 'failed', error: 'No LLM API keys configured' });
  });

  it('waits while the run is still going', () => {
    const record: AnalyseRunRecord = { status: 'running', startedAt: 'x' };
    expect(readAnalyseHandoff(record, 100_000)).toEqual({ kind: 'wait' });
  });

  it('waits briefly for a document that has not appeared yet', () => {
    expect(readAnalyseHandoff(null, HANDOFF_GRACE_MS - 1)).toEqual({ kind: 'wait' });
  });

  it('gives up once no document has appeared within the grace period — the request never landed', () => {
    const verdict = readAnalyseHandoff(null, HANDOFF_GRACE_MS);
    expect(verdict).toEqual({ kind: 'give-up', reason: 'the analyse never reached the server' });
  });

  it('gives up on a run still marked running past the function timeout', () => {
    const record: AnalyseRunRecord = { status: 'running', startedAt: 'x' };
    expect(readAnalyseHandoff(record, HANDOFF_DEADLINE_MS)).toEqual({
      kind: 'give-up',
      reason: 'the analyse ran out of time',
    });
  });

  it('does not hang on a done record with no result', () => {
    const record: AnalyseRunRecord = { status: 'done', startedAt: 'x' };
    expect(readAnalyseHandoff(record, HANDOFF_GRACE_MS).kind).toBe('give-up');
    expect(readAnalyseHandoff(record, 1_000).kind).toBe('wait');
  });
});

describe('isValidAnalyseRequestId', () => {
  it('accepts the ids generateId mints', () => {
    expect(isValidAnalyseRequestId('1788778288262-9vrghsoj6')).toBe(true);
  });

  it('rejects anything that would escape the document path', () => {
    for (const bad of ['', '.', '..', 'a/b', 'users/u1/documents/q1', 'x'.repeat(129), 42, null, undefined]) {
      expect(isValidAnalyseRequestId(bad)).toBe(false);
    }
  });
});
