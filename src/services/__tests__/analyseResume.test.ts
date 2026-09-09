/**
 * Collecting an analyse the last app process sent and never lived to see.
 *
 * The scenario: the OS killed the app mid-analyse. The server finished and
 * parked the gear list; the request id survived only in the analyse ledger.
 * On the next launch the result must land on the draft through the same
 * pipeline code a live run uses, and the draft must be parked where the
 * dashboard banner will find it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  deleteDoc: async () => {},
  onSnapshot: () => () => {},
}));

import {
  __resetAnalyseResume,
  planAnalyseResume,
  resumeUnfinishedAnalyses,
  type AnalyseResumeDeps,
} from '../analyseResume';
import type { AnalyseHandoffIo } from '../analyseHandoff';
import type { AnalyseLedgerEntry } from '../analyseLedger';
import type { AnalyseRunRecord } from '../../../shared/pricing/analyseRunDoc';
import type { Quote } from '../../types';

const RESULT = { materials: [{ name: 'Ceiling White 15L', quantity: 3, unit: 'each' }], estimatedHours: 64 };
const SENT_AT = 1_788_778_291_886; // when the incident's request left the phone
const NOW = SENT_AT + 6 * 60 * 60 * 1000; // relaunched six hours later

const emptyDraft = (id: string): Quote =>
  ({ id, status: 'draft', materials: [], job: { name: 'Interior repaint', description: 'Repaint' } }) as unknown as Quote;

/** A Firestore that answers every watch with the same record (or nothing). */
function handoffAnswering(record: AnalyseRunRecord | null | 'unreachable'): AnalyseHandoffIo {
  return {
    watch: (_id, onChange, onError) => {
      if (record === 'unreachable') onError(new Error('offline'));
      else Promise.resolve().then(() => onChange(record));
      return () => {};
    },
    forget: async () => {},
    now: () => NOW,
  };
}

function fakeDeps(opts: {
  entries: AnalyseLedgerEntry[];
  quotes: Quote[];
  parked: AnalyseRunRecord | null | 'unreachable';
  applyThrows?: boolean;
}) {
  const settled: string[] = [];
  const saved: Quote[] = [];
  const applied: string[] = [];
  const deps: AnalyseResumeDeps = {
    now: () => NOW,
    unsettled: async () => opts.entries,
    settled: async (id) => {
      settled.push(id);
    },
    findQuote: (id) => opts.quotes.find((q) => q.id === id),
    applyParked: async (quote, resume) => {
      if (opts.applyThrows) throw new Error('malformed');
      applied.push(resume.requestId);
      return { ...quote, materials: (resume.result as any).materials } as Quote;
    },
    saveDraft: async (quote) => {
      saved.push(quote);
    },
    handoffIo: handoffAnswering(opts.parked),
  };
  return { deps, settled, saved, applied };
}

describe('planAnalyseResume', () => {
  const done = { kind: 'done', result: RESULT } as const;

  it('applies a finished result to an empty draft', () => {
    expect(planAnalyseResume(emptyDraft('q1'), done)).toEqual({ kind: 'apply', result: RESULT });
  });

  it('drops it when the draft is gone', () => {
    expect(planAnalyseResume(undefined, done)).toEqual({ kind: 'drop' });
  });

  it('drops it when the draft already has rows — a gap-fill result would land twice', () => {
    const populated = { ...emptyDraft('q1'), materials: [{ name: 'x' }] } as unknown as Quote;
    expect(planAnalyseResume(populated, done)).toEqual({ kind: 'drop' });
  });

  it('keeps the entry when the server could not be reached — that is not its verdict', () => {
    expect(planAnalyseResume(emptyDraft('q1'), { kind: 'gone', reason: 'could not read the parked result' })).toEqual({
      kind: 'defer',
    });
  });

  it('drops it on every verdict that means nothing is coming', () => {
    for (const parked of [
      { kind: 'failed', error: 'Claude returned 529' },
      { kind: 'gone', reason: 'the analyse never reached the server' },
      { kind: 'gone', reason: 'the analyse ran out of time' },
      { kind: 'gone', reason: 'the result could not be parked' },
    ] as const) {
      expect(planAnalyseResume(emptyDraft('q1'), parked)).toEqual({ kind: 'drop' });
    }
  });
});

describe('resumeUnfinishedAnalyses', () => {
  beforeEach(() => {
    __resetAnalyseResume();
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const entry: AnalyseLedgerEntry = { requestId: 'req-1', quoteId: 'q1', sentAt: SENT_AT };
  const parkedDone: AnalyseRunRecord = { status: 'done', startedAt: 'x', finishedAt: 'y', result: RESULT };

  it('lands the parked gear list on the draft and parks it on the Fetch Prices step', async () => {
    const { deps, settled, saved, applied } = fakeDeps({ entries: [entry], quotes: [emptyDraft('q1')], parked: parkedDone });
    const pending = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);

    expect(await pending).toBe(1);
    expect(applied).toEqual(['req-1']);
    expect(saved).toHaveLength(1);
    expect(saved[0].materials).toHaveLength(1);
    expect(saved[0].draftStep).toBe('MaterialsList');
    expect(settled).toEqual(['req-1']);
  });

  it('runs once per process — a second call is a no-op', async () => {
    const { deps, applied } = fakeDeps({ entries: [entry], quotes: [emptyDraft('q1')], parked: parkedDone });
    const first = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);
    await first;
    expect(await resumeUnfinishedAnalyses(deps)).toBe(0);
    expect(applied).toHaveLength(1);
  });

  it('settles and skips a draft that already has rows without reading the server', async () => {
    const populated = { ...emptyDraft('q1'), materials: [{ name: 'x' }] } as unknown as Quote;
    const io = handoffAnswering(parkedDone);
    const watch = vi.spyOn(io, 'watch');
    const { deps, settled, saved } = fakeDeps({ entries: [entry], quotes: [populated], parked: parkedDone });
    deps.handoffIo = io;

    expect(await resumeUnfinishedAnalyses(deps)).toBe(0);
    expect(watch).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(settled).toEqual(['req-1']);
  });

  it('leaves the entry in the ledger when the phone is offline', async () => {
    const { deps, settled, saved } = fakeDeps({ entries: [entry], quotes: [emptyDraft('q1')], parked: 'unreachable' });
    const pending = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);

    expect(await pending).toBe(0);
    expect(saved).toEqual([]);
    expect(settled).toEqual([]);
  });

  it('settles a run the server reported as failed without touching the draft', async () => {
    const failed: AnalyseRunRecord = { status: 'failed', error: 'Claude returned 529', startedAt: 'x' };
    const { deps, settled, saved } = fakeDeps({ entries: [entry], quotes: [emptyDraft('q1')], parked: failed });
    const pending = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);

    expect(await pending).toBe(0);
    expect(saved).toEqual([]);
    expect(settled).toEqual(['req-1']);
  });

  it('settles a result that could not be applied rather than retrying it every launch', async () => {
    const { deps, settled, saved } = fakeDeps({
      entries: [entry],
      quotes: [emptyDraft('q1')],
      parked: parkedDone,
      applyThrows: true,
    });
    const pending = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);

    expect(await pending).toBe(0);
    expect(saved).toEqual([]);
    expect(settled).toEqual(['req-1']);
  });

  it('handles several entries independently', async () => {
    const entries: AnalyseLedgerEntry[] = [
      { requestId: 'req-gone', quoteId: 'deleted', sentAt: SENT_AT },
      { requestId: 'req-live', quoteId: 'q1', sentAt: SENT_AT + 1 },
    ];
    const { deps, settled, saved } = fakeDeps({ entries, quotes: [emptyDraft('q1')], parked: parkedDone });
    const pending = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);

    expect(await pending).toBe(1);
    expect(saved.map((q) => q.id)).toEqual(['q1']);
    expect(settled.sort()).toEqual(['req-gone', 'req-live']);
  });
});
