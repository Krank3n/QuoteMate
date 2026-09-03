import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  deleteDoc: async () => {},
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: () => () => {},
  runTransaction: async () => false,
  setDoc: async () => {},
}));
vi.mock('../firestoreService', () => ({ firestoreService: { getQuote: async () => null } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }));

import { __resetPricingRunResume, resumePlanFor, resumeUnfinishedPricingRuns, type ResumeDeps } from './pricingRunResume';
import type { PricingRunRecord } from '../../../shared/pricing/pricingRunDoc';
import type { ServerRunIo } from '../serverPricingRun';
import type { ChatMessage } from '../../types/assistant';

const entry = { runId: 'r1', quoteId: 'q1', jobName: 'Deck rebuild', createdAt: '2026-09-03T02:00:00.000Z' };
const now = Date.parse('2026-09-03T02:05:00.000Z');
const record = (patch: Partial<PricingRunRecord>): PricingRunRecord => ({
  quoteId: 'q1',
  kind: 'draft',
  options: { stripLabour: false, labourOnly: false },
  status: 'queued',
  createdAt: entry.createdAt,
  ...patch,
});

describe('resumePlanFor', () => {
  it('turns a finished run into a card that opens the quote and a note that stops Mate re-drafting it', () => {
    const plan = resumePlanFor(
      entry,
      record({ status: 'done', result: { generatedMaterialCount: 12, fetchedCount: 11, failedCount: 1, skippedCount: 0, missedSupplierTerms: [], reeceReauthNeeded: false } }),
      { nowMs: now, quoteTotal: 4120.5 },
    );
    expect(plan.kind).toBe('card');
    if (plan.kind !== 'card') throw new Error('unreachable');
    expect(plan.working).toMatchObject({ phase: 'done', done: true, summary: '11 priced · 1 need pricing' });
    expect(plan.text).toContain('Deck rebuild');
    expect(plan.text).toContain('12 items');
    expect(plan.text).toContain('$4,120.50');
    expect(plan.note).toContain('[context] Quote q1');
    expect(plan.note).toMatch(/do NOT draft a new quote/);
    expect(plan.cancel).toBeUndefined();
  });

  it('turns a failed, cancelled, or never-claimed run into a snag card, cancelling the unclaimed one', () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const plan = resumePlanFor(entry, record({ status, error: 'boom' }), { nowMs: now });
      expect(plan.kind).toBe('card');
      if (plan.kind !== 'card') continue;
      expect(plan.working.phase).toBe('failed');
      expect(plan.text).toMatch(/Continue Quote/);
      expect(plan.note).toMatch(/propose_reprice on q1/);
      expect(plan.cancel).toBeFalsy();
    }
    const queued = resumePlanFor(entry, record({ status: 'queued' }), { nowMs: now });
    expect(queued.kind === 'card' && queued.cancel).toBe(true);
  });

  it('re-attaches to a run that is still reporting, and gives up on one that went quiet', () => {
    const fresh = record({ status: 'running', updatedAt: new Date(now - 30_000).toISOString() });
    expect(resumePlanFor(entry, fresh, { nowMs: now })).toEqual({ kind: 'watch' });
    const quiet = record({ status: 'running', updatedAt: new Date(now - 10 * 60_000).toISOString() });
    expect(resumePlanFor(entry, quiet, { nowMs: now }).kind).toBe('card');
  });

  it('drops a run whose document is gone', () => {
    expect(resumePlanFor(entry, null, { nowMs: now })).toEqual({ kind: 'drop' });
  });
});

describe('resumeUnfinishedPricingRuns', () => {
  beforeEach(() => __resetPricingRunResume());
  afterEach(() => vi.useRealTimers());

  function deps(records: Record<string, PricingRunRecord | null>, entries = [entry]) {
    const appended: ChatMessage[] = [];
    const notes: string[] = [];
    const settled: string[] = [];
    const cancelled: string[] = [];
    const io = {
      uid: () => 'u1',
      readRun: async (runId: string) => records[runId] ?? null,
      cancelIfQueued: async (runId: string) => {
        cancelled.push(runId);
        return true;
      },
      ledger: {
        started: async () => {},
        settled: async (runId: string) => {
          settled.push(runId);
        },
        unsettled: async () => entries,
      },
      subscribeAppState: () => () => {},
      setForeground: async () => {},
      watchRun: () => () => {},
      now: () => now,
    } as unknown as ServerRunIo;
    const d: ResumeDeps = {
      io,
      now: () => now,
      quoteTotal: () => 900,
      appendMessage: (m) => appended.push(m),
      updateMessage: () => {},
      noteToMate: (t) => notes.push(t),
    };
    return { d, appended, notes, settled, cancelled };
  }

  it('shows the card, hands Mate the note, and settles the ledger — once per launch', async () => {
    const { d, appended, notes, settled } = deps({ r1: record({ status: 'done', result: { generatedMaterialCount: 3, fetchedCount: 3, failedCount: 0, skippedCount: 0, missedSupplierTerms: [], reeceReauthNeeded: false } }) });
    expect(await resumeUnfinishedPricingRuns(d)).toBe(1);
    expect(appended.map((m) => (m.working ? 'card' : m.cta ? 'cta' : 'text'))).toEqual(['card', 'cta']);
    expect(appended[1].cta).toEqual({ label: 'Open the quote', action: { type: 'open_quote', quoteId: 'q1' } });
    expect(notes[0]).toContain('[context] Quote q1');
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toEqual(['r1']);
    // A second call in the same process is a no-op.
    expect(await resumeUnfinishedPricingRuns(d)).toBe(0);
  });

  it('cancels a run nobody claimed and drops one whose document is gone', async () => {
    const { d, appended, cancelled, settled } = deps({ r1: record({ status: 'queued' }), r2: null }, [entry, { ...entry, runId: 'r2', quoteId: 'q2' }]);
    expect(await resumeUnfinishedPricingRuns(d)).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelled).toEqual(['r1']);
    expect(settled.sort()).toEqual(['r1', 'r2']);
    expect(appended.filter((m) => m.working)).toHaveLength(1);
  });
});
