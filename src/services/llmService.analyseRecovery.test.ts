/**
 * Regression test for the 7 Sep 2026 lost analyse.
 *
 * On an interior-repaint draft, analyzeJobDescription started 10:51:31Z and
 * finished 200 after 108,834 ms — users/{uid}/featureUsage/20260907 recorded
 * the run as a success. The tradie got nothing. iOS had suspended the app during the wait, the socket died,
 * and at 10:55:26Z the phone raised `TypeError: Network request failed` and
 * threw away a finished gear list. The quote was never written again: zero
 * materials, no draftStep, and Mate told them to tap a button that isn't on
 * screen when there are no rows.
 *
 * The fetch is still a single attempt — a blind retry is another two minutes
 * of Opus. What must hold now is that a lost RESPONSE is not a lost RUN: the
 * server parks its result at users/{uid}/analyseRuns/{requestId} and the phone
 * collects it.
 *
 * These tests drive the real analyseHandoff plumbing through a mocked
 * firebase/firestore, so the request id actually has to travel from the
 * request body to the document read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Simulate a native runtime — the platform the bug happened on.
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

/** What the "server" has parked, keyed by the request id the client minted. */
const parked = new Map<string, any>();
const deleted: string[] = [];
/** Delay before the snapshot listener answers, in ms of fake time. */
let snapshotDelayMs = 0;

vi.mock('firebase/firestore', () => ({
  // The real doc() builds a reference from path segments; the last one is the
  // request id, which is all the fake listener needs to find its record.
  doc: (_db: unknown, ...path: string[]) => ({ id: path[path.length - 1] }),
  deleteDoc: async (ref: { id: string }) => {
    deleted.push(ref.id);
    parked.delete(ref.id);
  },
  onSnapshot: (
    ref: { id: string },
    next: (snap: { exists: () => boolean; data: () => any }) => void,
    _err: (e: unknown) => void,
  ) => {
    const timer = setTimeout(() => {
      const record = parked.get(ref.id);
      next({ exists: () => !!record, data: () => record });
    }, snapshotDelayMs);
    return () => clearTimeout(timer);
  },
}));

const fetchMock = vi.fn();

const SCOPE =
  'Interior repaint of a single-storey 4-bedroom, 2-bathroom house including theatre room, ' +
  'hallway, and open-plan kitchen/living. Paint walls, ceilings and trims throughout, two coats, ' +
  'standard white colour scheme. Includes small patch works throughout, sanding and gapping.';

const SERVER_PAYLOAD = {
  materials: [
    { name: 'Dulux Wash & Wear Low Sheen White 10L', quantity: 6, unit: 'each', searchTerm: 'dulux wash wear 10l' },
    { name: 'Ceiling White 15L', quantity: 3, unit: 'each', searchTerm: 'ceiling white 15l' },
  ],
  estimatedHours: 64,
  jobSummary: 'Interior repaint, walls ceilings and trims, two coats.',
};

async function importFresh() {
  vi.resetModules();
  const mod = await import('./llmService');
  const { auth } = await import('../config/firebase');
  (auth as any).currentUser = { uid: 'test-uid', getIdToken: vi.fn(async () => 'test-token') };
  return mod;
}

/** The request id the client put on the wire for its one and only attempt. */
function sentRequestId(): string {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchMock.mock.calls[0][1].body).requestId;
}

beforeEach(() => {
  fetchMock.mockReset();
  parked.clear();
  deleted.length = 0;
  snapshotDelayMs = 0;
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('analyzeJobDescription when the response never comes home', () => {
  it('collects the parked result instead of throwing "Network request failed"', async () => {
    // The server finished and parked its answer; the phone's socket is dead.
    fetchMock.mockImplementation((_url: string, init: any) => {
      parked.set(JSON.parse(init.body).requestId, {
        status: 'done',
        startedAt: '2026-09-07T10:51:31.886Z',
        finishedAt: '2026-09-07T10:53:20.721Z',
        result: SERVER_PAYLOAD,
      });
      return Promise.reject(new TypeError('Network request failed'));
    });

    const { analyzeJobDescription } = await importFresh();
    const result = await analyzeJobDescription(SCOPE);

    expect(result.materials).toHaveLength(2);
    expect(result.materials[0].name).toBe('Dulux Wash & Wear Low Sheen White 10L');
    expect(result.estimatedHours).toBe(64);
    // One attempt only — the recovery must never become a second Opus run.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // And the parked copy is cleaned up once it has been used.
    expect(deleted).toEqual([sentRequestId()]);
  });

  it('sends a request id the server can park against, and never reuses it', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => SERVER_PAYLOAD });
    const { analyzeJobDescription } = await importFresh();

    await analyzeJobDescription(SCOPE);
    await analyzeJobDescription(SCOPE);

    const ids = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).requestId);
    expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    // A re-run is a re-run: an id derived from the scope would hand the tradie
    // back the identical list they just asked to be redone.
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('still fails when the request never reached the server', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const { analyzeJobDescription } = await importFresh();

    const pending = analyzeJobDescription(SCOPE);
    const assertion = expect(pending).rejects.toThrow('Network request failed');
    // Nothing was ever parked, so the wait runs out its grace period.
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('surfaces a genuine server-side failure rather than the transport error', async () => {
    fetchMock.mockImplementation((_url: string, init: any) => {
      parked.set(JSON.parse(init.body).requestId, {
        status: 'failed',
        error: 'Claude returned 529',
        startedAt: '2026-09-07T10:51:31.886Z',
      });
      return Promise.reject(new TypeError('Network request failed'));
    });

    const { analyzeJobDescription } = await importFresh();
    await expect(analyzeJobDescription(SCOPE)).rejects.toThrow('Claude returned 529');
  });

  it('does not go looking for a parked result when the server answered and refused', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'Too many requests' }) });
    const { analyzeJobDescription } = await importFresh();

    // No timers are advanced: a refusal must resolve immediately, not sit in
    // the handoff wait for its grace period.
    await expect(analyzeJobDescription(SCOPE)).rejects.toThrow('Too many requests');
  });

  it('lets go of a request that never settles and reads the result instead', async () => {
    vi.useFakeTimers();
    let abortReason: unknown;
    fetchMock.mockImplementation(
      (_url: string, init: any) =>
        new Promise((_resolve, reject) => {
          parked.set(JSON.parse(init.body).requestId, {
            status: 'done',
            startedAt: 'x',
            result: SERVER_PAYLOAD,
          });
          // A socket that answers neither way — only the abort ends it.
          init.signal.addEventListener('abort', () => {
            abortReason = init.signal.reason;
            reject(new Error('Aborted'));
          });
        }),
    );

    const { analyzeJobDescription } = await importFresh();
    const pending = analyzeJobDescription(SCOPE);
    await vi.advanceTimersByTimeAsync(310_000);

    const result = await pending;
    expect(abortReason).toBeDefined();
    expect(result.materials).toHaveLength(2);
  });
});
