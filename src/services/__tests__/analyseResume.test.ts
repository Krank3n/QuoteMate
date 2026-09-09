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
  isResumableDraft,
  planAnalyseResume,
  resumeBlocker,
  resumeUnfinishedAnalyses,
  type AnalyseResumeDeps,
} from '../analyseResume';
import type { AnalyseHandoffIo } from '../analyseHandoff';
import type { AnalyseLedgerEntry } from '../analyseLedger';
import type { AnalyseRunRecord } from '../../../shared/pricing/analyseRunDoc';
import type { Quote } from '../../types';

const RESULT = { materials: [{ name: 'Ceiling White 15L', quantity: 3, unit: 'each' }], estimatedHours: 64 };
const SENT_AT = 1_800_000_000_000; // an arbitrary fixed instant the request left the phone
const NOW = SENT_AT + 6 * 60 * 60 * 1000; // relaunched six hours later

const emptyDraft = (id: string): Quote =>
  ({ id, status: 'draft', materials: [], job: { name: 'Interior repaint', description: 'Repaint' } }) as unknown as Quote;

/** A Firestore that answers every watch with the same record (or nothing). */
function handoffAnswering(record: AnalyseRunRecord | null | 'unreachable'): AnalyseHandoffIo {
  return {
    watch: (_id, onChange, onError) => {
      if (record === 'unreachable') onError(new Error('offline'));
      else Promise.resolve().then(() => onChange(record, { fromCache: false }));
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
  currentQuoteId?: string;
  /** Runs when the wait starts — the tradie doing something meanwhile. */
  duringWait?: () => void;
  /** The store's save resolved but wrote nothing — it swallows its own errors. */
  persistSilentlyFails?: boolean;
}) {
  const settled: string[] = [];
  const saved: Quote[] = [];
  const applied: string[] = [];
  const forgotten: string[] = [];
  const io = handoffAnswering(opts.parked);
  const deps: AnalyseResumeDeps = {
    now: () => NOW,
    unsettled: async () => opts.entries,
    settled: async (id) => {
      settled.push(id);
    },
    // Reads the LIVE list, so a change made during the wait is visible after it.
    findQuote: (id) => opts.quotes.find((q) => q.id === id),
    currentQuoteId: () => opts.currentQuoteId,
    applyParked: async (quote, resume) => {
      if (opts.applyThrows) throw new Error('malformed');
      applied.push(resume.requestId);
      return { ...quote, materials: (resume.result as any).materials } as Quote;
    },
    // Like the store: the saved copy becomes what findQuote returns.
    persist: async (quote) => {
      if (!opts.persistSilentlyFails) {
        const i = opts.quotes.findIndex((q) => q.id === quote.id);
        if (i >= 0) opts.quotes[i] = quote;
      }
      saved.push(quote);
    },
    forgetParked: (id) => {
      forgotten.push(id);
    },
    handoffIo: {
      ...io,
      watch: (id, onChange, onError) => {
        opts.duringWait?.();
        return io.watch(id, onChange, onError);
      },
    },
  };
  return { deps, settled, saved, applied, forgotten };
}

describe('isResumableDraft — the only quote a parked analyse may land on', () => {
  it('accepts an untouched draft that is not open on screen', () => {
    expect(isResumableDraft(emptyDraft('q1'), undefined)).toBe(true);
    expect(isResumableDraft(emptyDraft('q1'), 'some-other-quote')).toBe(true);
  });

  it('refuses a quote that has been SENT — replacing rows under a customer is the worst outcome', () => {
    for (const sent of [
      { ...emptyDraft('q1'), status: 'sent' },
      { ...emptyDraft('q1'), status: 'accepted' },
      { ...emptyDraft('q1'), sentAt: 1_800_000_100_000 },
    ] as unknown as Quote[]) {
      expect(isResumableDraft(sent, undefined)).toBe(false);
    }
  });

  it('refuses a quote that has been invoiced', () => {
    expect(isResumableDraft({ ...emptyDraft('q1'), invoiceId: 'inv-1' } as unknown as Quote, undefined)).toBe(false);
    expect(isResumableDraft({ ...emptyDraft('q1'), invoicedAt: new Date() } as unknown as Quote, undefined)).toBe(false);
  });

  it('refuses a draft that already has rows — a gap-fill result would land twice', () => {
    expect(isResumableDraft({ ...emptyDraft('q1'), materials: [{ name: 'x' }] } as unknown as Quote, undefined)).toBe(false);
  });

  it('refuses the quote the tradie has open right now — as a transient block, not a permanent one', () => {
    expect(isResumableDraft(emptyDraft('q1'), 'q1')).toBe(false);
    expect(resumeBlocker(emptyDraft('q1'), 'q1')).toBe('transient');
    expect(resumeBlocker({ ...emptyDraft('q1'), status: 'sent' } as unknown as Quote, undefined)).toBe('permanent');
  });

  it('refuses a draft that is gone', () => {
    expect(isResumableDraft(undefined, undefined)).toBe(false);
  });
});

describe('planAnalyseResume', () => {
  const done = { kind: 'done', result: RESULT } as const;

  it('applies a finished result to an untouched draft', () => {
    expect(planAnalyseResume(emptyDraft('q1'), undefined, done)).toEqual({ kind: 'apply', result: RESULT });
  });

  it('drops it when the draft can never take the result, whatever the server says', () => {
    expect(planAnalyseResume(undefined, undefined, done)).toEqual({ kind: 'drop' });
    expect(planAnalyseResume({ ...emptyDraft('q1'), status: 'sent' } as unknown as Quote, undefined, done)).toEqual({ kind: 'drop' });
  });

  it('defers — keeps the entry — when the draft is merely open on screen right now', () => {
    expect(planAnalyseResume(emptyDraft('q1'), 'q1', done)).toEqual({ kind: 'defer' });
  });

  it('keeps the entry when the server could not be reached — even if the draft looks unresumable today', () => {
    const offline = { kind: 'gone', reason: 'could not read the parked result' } as const;
    expect(planAnalyseResume(emptyDraft('q1'), undefined, offline)).toEqual({ kind: 'defer' });
    // Open on screen right now; may not be next launch. Not the server's verdict, so not dropped.
    expect(planAnalyseResume(emptyDraft('q1'), 'q1', offline)).toEqual({ kind: 'defer' });
  });

  it('drops it on every verdict that means nothing is coming', () => {
    for (const parked of [
      { kind: 'failed', error: 'Claude returned 529' },
      { kind: 'gone', reason: 'the analyse never reached the server' },
      { kind: 'gone', reason: 'the analyse ran out of time' },
      { kind: 'gone', reason: 'the result could not be parked' },
    ] as const) {
      expect(planAnalyseResume(emptyDraft('q1'), undefined, parked)).toEqual({ kind: 'drop' });
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

  it('deletes the parked copy only AFTER the draft is persisted, and not at all if that fails', async () => {
    const quotes = [emptyDraft('q1')];
    const ok = fakeDeps({ entries: [entry], quotes, parked: parkedDone });
    const order: string[] = [];
    ok.deps.persist = async (quote) => {
      // Like the store: the saved copy is what findQuote returns afterwards.
      quotes[0] = quote;
      order.push('persist');
    };
    ok.deps.forgetParked = () => {
      order.push('forget');
    };
    const p1 = resumeUnfinishedAnalyses(ok.deps);
    await vi.advanceTimersByTimeAsync(10);
    await p1;
    expect(order).toEqual(['persist', 'forget']);

    __resetAnalyseResume();
    const bad = fakeDeps({ entries: [entry], quotes: [emptyDraft('q1')], parked: parkedDone, applyThrows: true });
    const p2 = resumeUnfinishedAnalyses(bad.deps);
    await vi.advanceTimersByTimeAsync(10);
    await p2;
    expect(bad.forgotten).toEqual([]);
  });

  it('does not delete the parked copy when the save silently wrote nothing', async () => {
    const { deps, forgotten, settled } = fakeDeps({
      entries: [entry],
      quotes: [emptyDraft('q1')],
      parked: parkedDone,
      persistSilentlyFails: true,
    });
    const pending = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toBe(0);
    expect(forgotten).toEqual([]);
    // Retrying would hit the same wall; the entry is settled, the doc left for the TTL.
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

  it('re-reads the draft AFTER the wait — rows the tradie built meanwhile are never overwritten', async () => {
    // The server is still running when the wait starts; the tradie opens the
    // draft and adds a row by hand before it finishes. The snapshot from
    // before the wait said "empty"; the decision must not be made from it.
    const quotes = [emptyDraft('q1')];
    const { deps, settled, saved } = fakeDeps({
      entries: [entry],
      quotes,
      parked: parkedDone,
      duringWait: () => {
        quotes[0] = { ...quotes[0], materials: [{ name: 'Hand-added row' }] } as unknown as Quote;
      },
    });
    const pending = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);

    expect(await pending).toBe(0);
    expect(saved).toEqual([]);
    expect(settled).toEqual(['req-1']);
  });

  it('will not touch a draft that was sent while the app was closed', async () => {
    const sent = { ...emptyDraft('q1'), status: 'sent', sentAt: SENT_AT + 1_000 } as unknown as Quote;
    const { deps, settled, saved } = fakeDeps({ entries: [entry], quotes: [sent], parked: parkedDone });
    const pending = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toBe(0);
    expect(saved).toEqual([]);
    expect(settled).toEqual(['req-1']);
  });

  it('leaves the quote the tradie has open alone, and keeps the entry for a later launch', async () => {
    // Open on screen now: the entry stays without even reading the server;
    // nothing is written.
    const io = handoffAnswering(parkedDone);
    const watch = vi.spyOn(io, 'watch');
    const { deps, settled, saved } = fakeDeps({
      entries: [entry],
      quotes: [emptyDraft('q1')],
      parked: parkedDone,
      currentQuoteId: 'q1',
    });
    deps.handoffIo = io;
    const pendingOpen = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pendingOpen).toBe(0);
    expect(watch).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(settled).toEqual([]);
  });

  it('persists through the background path, never the wizard save', async () => {
    const { deps, saved } = fakeDeps({ entries: [entry], quotes: [emptyDraft('q1')], parked: parkedDone });
    const persist = vi.spyOn(deps, 'persist');
    const pending = resumeUnfinishedAnalyses(deps);
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(persist).toHaveBeenCalledTimes(1);
    expect(saved[0].draftStep).toBe('MaterialsList');
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
