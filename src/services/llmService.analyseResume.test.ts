/**
 * The analyse call's two phone-only extras: the ledger entry that outlives
 * the process, and resume mode — returning a payload a previous process
 * parked instead of asking the server again.
 *
 * The app-kill scenario: the OS killed the app mid-analyse, so the recovery
 * in analyseHandoff never ran. The request id has to survive in AsyncStorage
 * from the moment the request is SENT, and be removed on every outcome the
 * process lives to see, so the ledger is exactly "what died in flight".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const parked = new Map<string, any>();
const deleted: string[] = [];
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ id: path[path.length - 1] }),
  deleteDoc: async (ref: { id: string }) => {
    deleted.push(ref.id);
  },
  onSnapshot: (ref: { id: string }, next: (snap: { exists: () => boolean; data: () => any }) => void) => {
    const timer = setTimeout(() => {
      const record = parked.get(ref.id);
      next({ exists: () => !!record, data: () => record });
    }, 0);
    return () => clearTimeout(timer);
  },
}));

/** In-memory AsyncStorage: the ledger's home. */
const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
  },
}));

const fetchMock = vi.fn();
const PAYLOAD = {
  materials: [{ name: 'Ceiling White 15L', quantity: 3, unit: 'each', searchTerm: 'ceiling white 15l' }],
  estimatedHours: 64,
  jobSummary: 'Interior repaint.',
};

async function importFresh() {
  vi.resetModules();
  const mod = await import('./llmService');
  const ledger = await import('./analyseLedger');
  const { auth } = await import('../config/firebase');
  (auth as any).currentUser = { uid: 'test-uid', getIdToken: vi.fn(async () => 'test-token') };
  return { ...mod, ledger };
}

beforeEach(() => {
  fetchMock.mockReset();
  parked.clear();
  deleted.length = 0;
  storage.clear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the analyse ledger around a live request', () => {
  it('holds the request id from send until the response lands', async () => {
    let duringFlight: unknown[] = [];
    const { analyzeJobDescription, ledger } = await importFresh();
    fetchMock.mockImplementation(async () => {
      // Sampled while the request is in flight — the window an app kill hits.
      duringFlight = await ledger.listUnsettledAnalyses(Date.now());
      return { ok: true, json: async () => PAYLOAD };
    });

    await analyzeJobDescription('Repaint', undefined, undefined, undefined, undefined, undefined, { quoteId: 'q1' });

    expect(duringFlight).toHaveLength(1);
    expect((duringFlight[0] as any).quoteId).toBe('q1');
    expect((duringFlight[0] as any).requestId).toBe(JSON.parse(fetchMock.mock.calls[0][1].body).requestId);
    // Settled once this process saw the outcome — nothing left to resume.
    await Promise.resolve();
    expect(await ledger.listUnsettledAnalyses(Date.now())).toEqual([]);
  });

  it('settles the entry on a refusal and on a lost response too', async () => {
    const { analyzeJobDescription, ledger } = await importFresh();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    await expect(
      analyzeJobDescription('Repaint', undefined, undefined, undefined, undefined, undefined, { quoteId: 'q1' }),
    ).rejects.toThrow('boom');
    await Promise.resolve();
    expect(await ledger.listUnsettledAnalyses(Date.now())).toEqual([]);

    // Lost response, result parked: recovered in-process, so nothing outlives it.
    fetchMock.mockImplementationOnce((_url: string, init: any) => {
      parked.set(JSON.parse(init.body).requestId, { status: 'done', startedAt: 'x', result: PAYLOAD });
      return Promise.reject(new TypeError('Network request failed'));
    });
    const result = await analyzeJobDescription('Repaint', undefined, undefined, undefined, undefined, undefined, { quoteId: 'q1' });
    expect(result.materials).toHaveLength(1);
    await Promise.resolve();
    expect(await ledger.listUnsettledAnalyses(Date.now())).toEqual([]);
  });

  it('writes no ledger entry for a call that is not tied to a quote', async () => {
    const { analyzeJobDescription, ledger } = await importFresh();
    let duringFlight: unknown[] = [];
    fetchMock.mockImplementation(async () => {
      duringFlight = await ledger.listUnsettledAnalyses(Date.now());
      return { ok: true, json: async () => PAYLOAD };
    });
    await analyzeJobDescription('Repaint');
    expect(duringFlight).toEqual([]);
  });
});

describe('resume mode', () => {
  it('returns the parked payload without touching the network, and forgets the doc', async () => {
    const { analyzeJobDescription } = await importFresh();
    const result = await analyzeJobDescription('Repaint', undefined, undefined, undefined, undefined, undefined, {
      quoteId: 'q1',
      resume: { requestId: 'req-from-last-launch', result: PAYLOAD },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.materials[0].name).toBe('Ceiling White 15L');
    expect(result.estimatedHours).toBe(64);
    await Promise.resolve();
    expect(deleted).toEqual(['req-from-last-launch']);
  });

  it('normalises the parked payload exactly as a fresh response would be', async () => {
    const { analyzeJobDescription } = await importFresh();
    // A raw payload with an out-of-range hours figure and a junk tier: the
    // normaliser must clamp and drop them on this path too.
    const result = await analyzeJobDescription('Repaint', undefined, undefined, undefined, undefined, undefined, {
      resume: { requestId: 'r', result: { ...PAYLOAD, estimatedHours: 9_999, jobQualityTier: 'platinum' } },
    });
    expect(result.estimatedHours).toBe(200);
    expect((result as any).jobQualityTier).toBeUndefined();
  });
});
