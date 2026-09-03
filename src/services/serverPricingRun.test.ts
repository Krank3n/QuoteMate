import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'ios' },
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  deleteDoc: async () => {},
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: () => () => {},
  runTransaction: async () => false,
  setDoc: async () => {},
}));
vi.mock('./firestoreService', () => ({ firestoreService: { getQuote: async () => null } }));

import {
  CREATE_TIMEOUT_MS,
  HEARTBEAT_MS,
  QUEUE_NUDGE_MS,
  QUEUE_TIMEOUT_MS,
  STALE_TIMEOUT_MS,
  runPipelineOnServer,
  type ServerRunIo,
} from './serverPricingRun';
import type { PricingRunRecord } from '../../shared/pricing/pricingRunDoc';
import type { Quote } from '../types';

/**
 * An in-memory stand-in for Firestore + AppState. Tests drive the run
 * document the way the server would and check what the phone does about it.
 */
function fakeIo(overrides: Partial<ServerRunIo> = {}) {
  let record: PricingRunRecord | null = null;
  let watcher: ((r: PricingRunRecord | null) => void) | null = null;
  let watchError: ((e: unknown) => void) | null = null;
  let appStateListener: ((state: string) => void) | null = null;
  const foregroundWrites: boolean[] = [];
  const deleted: string[] = [];
  const cancels: string[] = [];
  const io: ServerRunIo = {
    uid: () => 'u1',
    isEnabled: async () => true,
    createRun: async (_id, r) => {
      record = r;
    },
    deleteRun: async (id) => {
      deleted.push(id);
    },
    watchRun: (_id, onChange, onError) => {
      watcher = onChange;
      watchError = onError;
      // Firestore echoes our own write straight back.
      Promise.resolve().then(() => onChange(record));
      return () => {
        watcher = null;
      };
    },
    cancelIfQueued: async (id) => {
      cancels.push(id);
      if (record && record.status === 'queued') {
        record = { ...record, status: 'cancelled' };
        return true;
      }
      return false;
    },
    setForeground: async (_id, fg) => {
      foregroundWrites.push(fg);
    },
    fetchQuote: async (quoteId) => ({ id: quoteId, materials: [{ id: 'm1', price: 12 }] } as unknown as Quote),
    subscribeAppState: (listener) => {
      appStateListener = listener;
      return () => {
        appStateListener = null;
      };
    },
    now: () => Date.now(),
    ...overrides,
  };
  const server = {
    /** What the Cloud Function would write. */
    advance(patch: Partial<PricingRunRecord>) {
      record = { ...(record as PricingRunRecord), ...patch };
      watcher?.(record);
    },
    failWatch(err: unknown) {
      watchError?.(err);
    },
    appState(state: string) {
      appStateListener?.(state);
    },
    get record() {
      return record;
    },
    foregroundWrites,
    deleted,
    cancels,
  };
  return { io, server };
}

const request = {
  quoteId: 'q1',
  kind: 'draft' as const,
  options: { stripLabour: false, labourOnly: false },
};

describe('runPipelineOnServer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams the server progress into the card and resolves with the priced quote', async () => {
    const { io, server } = fakeIo();
    const seen: Array<{ status: string; runsOnServer?: boolean }> = [];
    const pending = runPipelineOnServer(
      request,
      { onProgress: (s) => seen.push({ status: s.status, runsOnServer: s.runsOnServer }) },
      io,
    );
    await vi.advanceTimersByTimeAsync(10);

    expect(server.record?.status).toBe('queued');
    expect(server.record?.foreground).toBe(true);
    expect(server.record?.foregroundAt).toBeTruthy();
    // Queued is not "on the server" yet — the card must not say lock the phone.
    expect(seen[0]).toEqual({ status: 'Getting ready…', runsOnServer: false });
    server.advance({ status: 'running', progress: { phase: 'analyzing', status: 'Reading the scope…', done: false } });
    server.advance({ progress: { phase: 'pricing', status: 'Pricing 4 items…', done: false } });
    server.advance({
      status: 'done',
      progress: { phase: 'done', status: 'Drafted 4 items.', done: true, summary: '4 priced' },
      result: { generatedMaterialCount: 4, fetchedCount: 4, failedCount: 0, skippedCount: 0, missedSupplierTerms: [], reeceReauthNeeded: false },
    });
    await vi.advanceTimersByTimeAsync(10);

    const outcome = await pending;
    expect(outcome.kind).toBe('done');
    if (outcome.kind !== 'done') throw new Error('unreachable');
    expect(outcome.result.fetchedCount).toBe(4);
    expect(outcome.quote.id).toBe('q1');
    expect(seen.map((s) => s.status)).toEqual(['Getting ready…', 'Reading the scope…', 'Pricing 4 items…', 'Drafted 4 items.']);
    expect(seen.slice(1).every((s) => s.runsOnServer === true)).toBe(true);
  });

  it('admits a slow queue after a few seconds, and re-stamps the foreground while watching', async () => {
    const { io, server } = fakeIo();
    const seen: string[] = [];
    const pending = runPipelineOnServer(request, { onProgress: (s) => seen.push(s.status) }, io);
    await vi.advanceTimersByTimeAsync(QUEUE_NUDGE_MS + 50);
    expect(seen).toContain('Still lining up a spot — hang tight.');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(server.foregroundWrites).toEqual([true]);
    server.advance({ status: 'running' });
    server.advance({ status: 'failed', error: 'x' });
    await pending;
  });

  it('marks the phone away when the app is backgrounded and back when it returns', async () => {
    const { io, server } = fakeIo();
    const pending = runPipelineOnServer(request, {}, io);
    await vi.advanceTimersByTimeAsync(10);
    server.advance({ status: 'running' });
    server.appState('inactive');
    server.appState('background');
    server.appState('active');
    await vi.advanceTimersByTimeAsync(10);
    expect(server.foregroundWrites).toEqual([false, false, true]);
    server.advance({ status: 'failed', error: 'boom' });
    await pending;
  });

  it('falls back to the phone when nothing claims the run, cancelling it first', async () => {
    const { io, server } = fakeIo();
    const pending = runPipelineOnServer(request, {}, io);
    await vi.advanceTimersByTimeAsync(QUEUE_TIMEOUT_MS + 50);
    const outcome = await pending;
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'no server pickup' });
    expect(server.cancels).toHaveLength(1);
    expect(server.record?.status).toBe('cancelled');
  });

  it('treats its own cancellation echoing back early as the fallback, not a failure', async () => {
    const { io, server } = fakeIo({
      // The snapshot with status: cancelled arrives before the transaction resolves.
      cancelIfQueued: async () => {
        server.advance({ status: 'cancelled' });
        await new Promise((r) => setTimeout(r, 200));
        return true;
      },
    });
    const pending = runPipelineOnServer(request, {}, io);
    await vi.advanceTimersByTimeAsync(QUEUE_TIMEOUT_MS + 500);
    expect(await pending).toEqual({ kind: 'unavailable', reason: 'no server pickup' });
  });

  it('keeps waiting when the server claims the run just as the queue watchdog fires', async () => {
    const { io, server } = fakeIo({
      cancelIfQueued: async () => false, // the transaction saw status: running
    });
    const pending = runPipelineOnServer(request, {}, io);
    await vi.advanceTimersByTimeAsync(QUEUE_TIMEOUT_MS + 50);
    server.advance({ status: 'running' });
    server.advance({ status: 'failed', error: 'late failure' });
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual({ kind: 'failed', error: 'late failure' });
  });

  it('takes the run back and falls back when the create never reaches the server', async () => {
    const { io, server } = fakeIo({ createRun: () => new Promise(() => {}) });
    const pending = runPipelineOnServer(request, {}, io);
    await vi.advanceTimersByTimeAsync(CREATE_TIMEOUT_MS + 50);
    const outcome = await pending;
    expect(outcome.kind).toBe('unavailable');
    expect(server.deleted).toHaveLength(1);
  });

  it('reports a failed run with the server’s reason', async () => {
    const { io, server } = fakeIo();
    const pending = runPipelineOnServer(request, {}, io);
    await vi.advanceTimersByTimeAsync(10);
    server.advance({ status: 'running' });
    server.advance({ status: 'failed', error: 'Both LLM providers failed' });
    expect(await pending).toEqual({ kind: 'failed', error: 'Both LLM providers failed' });
  });

  it('gives up on a claimed run that stops reporting', async () => {
    let now = 0;
    const { io, server } = fakeIo({ now: () => now });
    const pending = runPipelineOnServer(request, {}, io);
    await vi.advanceTimersByTimeAsync(10);
    server.advance({ status: 'running' });
    now = STALE_TIMEOUT_MS + 1;
    await vi.advanceTimersByTimeAsync(20_000);
    const outcome = await pending;
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error).toMatch(/stopped reporting/);
  });

  it('is unavailable when the remote flag is off or nobody is signed in', async () => {
    expect(await runPipelineOnServer(request, {}, fakeIo({ isEnabled: async () => false }).io)).toEqual({
      kind: 'unavailable',
      reason: 'disabled',
    });
    expect(await runPipelineOnServer(request, {}, fakeIo({ uid: () => null }).io)).toEqual({
      kind: 'unavailable',
      reason: 'signed out',
    });
  });
});
