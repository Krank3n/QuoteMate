/**
 * The wait that collects an analyse whose HTTP response never came home.
 *
 * Drives the handoff document the way the Cloud Function would and checks
 * what the phone does about it, with no Firestore and no device — same
 * fake-IO arrangement as serverPricingRun.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  deleteDoc: async () => {},
  onSnapshot: () => () => {},
}));

import {
  HANDOFF_TICK_MS,
  forgetParkedAnalyse,
  waitForParkedAnalyse,
  type AnalyseHandoffIo,
} from '../analyseHandoff';
import {
  HANDOFF_DEADLINE_MS,
  HANDOFF_GRACE_MS,
  type AnalyseRunRecord,
} from '../../../shared/pricing/analyseRunDoc';

const RESULT = { materials: [{ name: 'Dulux Wash & Wear 10L', quantity: 6 }], estimatedHours: 40 };

function fakeIo(overrides: Partial<AnalyseHandoffIo> = {}) {
  let clock = 0;
  let publish: ((r: AnalyseRunRecord | null) => void) | null = null;
  let fail: ((e: unknown) => void) | null = null;
  const forgotten: string[] = [];
  let unsubscribed = 0;

  const io: AnalyseHandoffIo = {
    watch: (_id, onChange, onError) => {
      publish = onChange;
      fail = onError;
      return () => {
        unsubscribed += 1;
        publish = null;
      };
    },
    forget: async (id) => {
      forgotten.push(id);
    },
    now: () => clock,
    ...overrides,
  };

  return {
    io,
    server: {
      /** Firestore answering — with a record, or with "no such document". */
      say: (record: AnalyseRunRecord | null) => publish?.(record),
      erupt: (e: unknown) => fail?.(e),
      /** Move the injected clock without running any timers. */
      set: (ms: number) => {
        clock = ms;
      },
      get forgotten() {
        return forgotten;
      },
      get unsubscribed() {
        return unsubscribed;
      },
    },
  };
}

describe('waitForParkedAnalyse', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('collects a result parked four minutes ago — the 7 Sep 2026 failure', async () => {
    const { io, server } = fakeIo();
    // The fetch rejected 234 s after it was sent; the result landed at 109 s.
    server.set(234_000);
    const pending = waitForParkedAnalyse('req-1', 0, io);
    server.say({ status: 'done', startedAt: 'x', finishedAt: 'y', result: RESULT });
    await expect(pending).resolves.toEqual({ kind: 'done', result: RESULT });
    expect(server.unsubscribed).toBe(1);
  });

  it('keeps waiting while the server is still running, then takes the result', async () => {
    const { io, server } = fakeIo();
    const pending = waitForParkedAnalyse('req-1', 0, io);
    server.say({ status: 'running', startedAt: 'x' });
    server.set(100_000);
    await vi.advanceTimersByTimeAsync(HANDOFF_TICK_MS * 3);

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    server.say({ status: 'done', startedAt: 'x', result: RESULT });
    await expect(pending).resolves.toEqual({ kind: 'done', result: RESULT });
  });

  it('reports a genuine server-side failure instead of the network error', async () => {
    const { io, server } = fakeIo();
    const pending = waitForParkedAnalyse('req-1', 0, io);
    server.say({ status: 'failed', error: 'Claude returned 529', startedAt: 'x' });
    await expect(pending).resolves.toEqual({ kind: 'failed', error: 'Claude returned 529' });
  });

  it('gives up when the request never reached the server', async () => {
    const { io, server } = fakeIo();
    const pending = waitForParkedAnalyse('req-1', 0, io);
    server.say(null); // Firestore: no such document.
    server.set(HANDOFF_GRACE_MS);
    await vi.advanceTimersByTimeAsync(HANDOFF_TICK_MS + 10);
    await expect(pending).resolves.toEqual({
      kind: 'gone',
      reason: 'the analyse never reached the server',
    });
  });

  it('gives up on a run still marked running past the function timeout', async () => {
    const { io, server } = fakeIo();
    const pending = waitForParkedAnalyse('req-1', 0, io);
    server.say({ status: 'running', startedAt: 'x' });
    server.set(HANDOFF_DEADLINE_MS);
    await vi.advanceTimersByTimeAsync(HANDOFF_TICK_MS + 10);
    await expect(pending).resolves.toEqual({ kind: 'gone', reason: 'the analyse ran out of time' });
  });

  it('gives up when Firestore itself cannot be read', async () => {
    const { io, server } = fakeIo();
    const pending = waitForParkedAnalyse('req-1', 0, io);
    server.erupt(new Error('permission-denied'));
    await expect(pending).resolves.toEqual({
      kind: 'gone',
      reason: 'could not read the parked result',
    });
  });

  it('gives up when the listener never answers at all — an offline phone', async () => {
    // No say(), no erupt(): the subscription simply never fires. Without the
    // "heard nothing yet" rule this would sit here for the full deadline.
    const { io, server } = fakeIo();
    const pending = waitForParkedAnalyse('req-1', 0, io);
    server.set(HANDOFF_GRACE_MS);
    await vi.advanceTimersByTimeAsync(HANDOFF_TICK_MS + 10);
    await expect(pending).resolves.toEqual({
      kind: 'gone',
      reason: 'could not read the parked result',
    });
  });

  it('unsubscribes a watch that answers during subscribe — the signed-out path', async () => {
    // defaultAnalyseHandoffIo calls onError synchronously when there is no
    // uid, so finish() runs before there is anything to unsubscribe.
    let released = 0;
    const io: AnalyseHandoffIo = {
      watch: (_id, _onChange, onError) => {
        onError(new Error('signed out'));
        return () => {
          released += 1;
        };
      },
      forget: async () => {},
      now: () => 0,
    };
    await expect(waitForParkedAnalyse('req-1', 0, io)).resolves.toEqual({
      kind: 'gone',
      reason: 'could not read the parked result',
    });
    expect(released).toBe(1);
    // And no stray tick left behind to fire two seconds later.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not mistake a slow first snapshot for a missing document', async () => {
    // The wait starts 234 s after the request — already past the grace period
    // on the request clock. The listener answering a moment later must still
    // be believed.
    const { io, server } = fakeIo();
    server.set(234_000);
    const pending = waitForParkedAnalyse('req-1', 0, io);
    await vi.advanceTimersByTimeAsync(HANDOFF_TICK_MS * 2);
    server.say({ status: 'done', startedAt: 'x', result: RESULT });
    await expect(pending).resolves.toEqual({ kind: 'done', result: RESULT });
  });
});

describe('forgetParkedAnalyse', () => {
  it('deletes the document without making the caller wait or care', async () => {
    const { io, server } = fakeIo();
    forgetParkedAnalyse('req-1', io);
    await Promise.resolve();
    expect(server.forgotten).toEqual(['req-1']);
  });

  it('swallows a failed delete — the TTL policy is the backstop', async () => {
    const { io } = fakeIo({
      forget: async () => {
        throw new Error('offline');
      },
    });
    expect(() => forgetParkedAnalyse('req-1', io)).not.toThrow();
    await Promise.resolve();
  });
});
