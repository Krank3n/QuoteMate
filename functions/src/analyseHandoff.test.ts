/**
 * The server's side of the analyse handoff — parking a result where a phone
 * that lost its HTTP response can still collect it.
 *
 * The contract that matters: these writes are telemetry-grade. A handoff that
 * cannot be written must never turn a good analyse into a 500, and must never
 * mask the real error on the failure path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), {
    Timestamp: { fromMillis: (ms: number) => ({ __ts: ms }) },
  }),
}));

import { analyseHandoffWriter, HANDOFF_WRITE_TIMEOUT_MS } from './analyseHandoff';
import { ANALYSE_HANDOFF_TTL_MS } from './shared/pricing/analyseRunDoc';

function fakeDb(onSet?: (path: string, record: any) => void, config: Record<string, unknown> | null = null) {
  const writes: Array<{ path: string; record: any; merge?: boolean; create?: boolean }> = [];
  /** What each handoff document holds after the writes so far — create() needs to know. */
  const docs = new Map<string, any>();
  const db = () =>
    ({
      doc: (path: string) => ({
        // The kill-switch read; every other path is a handoff document.
        get: async () => (path === 'config/pipeline' ? { exists: config !== null, data: () => config } : { exists: docs.has(path), data: () => docs.get(path) }),
        set: async (record: any, options?: { merge?: boolean }) => {
          onSet?.(path, record);
          writes.push({ path, record, ...(options?.merge ? { merge: true } : {}) });
          docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...record } : record);
        },
        create: async (record: any) => {
          onSet?.(path, record);
          if (docs.has(path)) throw new Error('ALREADY_EXISTS');
          writes.push({ path, record, create: true });
          docs.set(path, record);
        },
      }),
    }) as any;
  return { db, writes, docs };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('analyseHandoffWriter', () => {
  it('parks the result under the caller’s request id', async () => {
    const { db, writes } = fakeDb();
    const handoff = analyseHandoffWriter('u1', 'req-1', db);

    await handoff.started();
    await handoff.done({ materials: [{ name: 'Ceiling White 15L' }], estimatedHours: 64 });

    expect(writes.map((w) => w.path)).toEqual([
      'users/u1/analyseRuns/req-1',
      'users/u1/analyseRuns/req-1',
    ]);
    expect(writes[0].record.status).toBe('running');
    expect(writes[0].create).toBe(true);
    expect(writes[1].record.status).toBe('done');
    expect(writes[1].record.result.estimatedHours).toBe(64);
    expect(writes[1].record.finishedAt).toBeTruthy();
  });

  it('keeps the original start time on the finishing write', async () => {
    const { db, writes } = fakeDb();
    const handoff = analyseHandoffWriter('u1', 'req-1', db);
    await handoff.started();
    await handoff.done({ materials: [] });
    expect(writes[1].record.startedAt).toBe(writes[0].record.startedAt);
  });

  it('stamps a TTL so an uncollected result does not live forever', async () => {
    const { db, writes } = fakeDb();
    const before = Date.now();
    await analyseHandoffWriter('u1', 'req-1', db).done({ materials: [] });
    const ttlMs = (writes[0].record.expiresAt as { __ts: number }).__ts;
    expect(ttlMs).toBeGreaterThanOrEqual(before + ANALYSE_HANDOFF_TTL_MS);
  });

  it('drops undefined values Firestore would reject the whole write over', async () => {
    const { db, writes } = fakeDb();
    await analyseHandoffWriter('u1', 'req-1', db).done({
      materials: [{ name: 'Gap filler', section: undefined }],
      jobQualityTier: undefined,
    } as any);

    const stored = writes[0].record.result;
    expect(stored.materials[0]).toEqual({ name: 'Gap filler' });
    expect('jobQualityTier' in stored).toBe(false);
  });

  it('records a failure so the phone reports the real reason, not the network', async () => {
    const { db, writes } = fakeDb();
    await analyseHandoffWriter('u1', 'req-1', db).failed('Claude returned 529');
    expect(writes[0].record).toMatchObject({ status: 'failed', error: 'Claude returned 529' });
  });

  it('writes nothing at all when the caller sent no request id', async () => {
    const { db, writes } = fakeDb();
    for (const id of [undefined, null, '', 'a/b', '..', 'x'.repeat(129), 7]) {
      const handoff = analyseHandoffWriter('u1', id, db);
      await handoff.started();
      await handoff.done({ materials: [] });
      await handoff.failed('boom');
    }
    expect(writes).toEqual([]);
  });

  it('gives up on a hung write rather than spending the analyse’s remaining budget', async () => {
    vi.useFakeTimers();
    try {
      const db = () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => null }), create: () => new Promise(() => {}), set: () => new Promise(() => {}) }) }) as any;
      const pending = analyseHandoffWriter('u1', 'req-1', db).done({ materials: [] });
      // The payload write times out, then the result-less marker gets its own
      // bounded go — so a dead Firestore costs at most 2 × the timeout here,
      // on the failure path only, and never the analyse's remaining budget.
      await vi.advanceTimersByTimeAsync(2 * HANDOFF_WRITE_TIMEOUT_MS + 10);
      await expect(pending).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        '[analyse handoff] write failed',
        expect.objectContaining({ what: 'done-marker', message: 'handoff write timed out' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no timer behind after a fast write', async () => {
    vi.useFakeTimers();
    try {
      const { db } = fakeDb();
      await analyseHandoffWriter('u1', 'req-1', db).done({ materials: [] });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a result-less done marker when the payload itself cannot be parked', async () => {
    // First write (the payload) fails; the marker must still land, or the
    // phone reads `running` and waits out the whole deadline.
    let calls = 0;
    const writes: any[] = [];
    const db = () =>
      ({
        doc: () => ({
          get: async () => ({ exists: false, data: () => null }),
          create: async () => {},
          set: async (record: any) => {
            calls += 1;
            if (calls === 1) throw new Error('document too large');
            writes.push(record);
          },
        }),
      }) as any;
    await analyseHandoffWriter('u1', 'req-1', db).done({ materials: [{ name: 'x' }] });
    expect(writes).toHaveLength(1);
    expect(writes[0].status).toBe('done');
    expect('result' in writes[0]).toBe(false);
  });

  it('MERGES the marker so a payload write that acks after the race is not erased', async () => {
    // The payload write timed out but is still in flight. A plain set of the
    // marker would overwrite a result that lands a moment later; merge keeps it.
    let calls = 0;
    const { db, writes } = fakeDb(() => {
      calls += 1;
      if (calls === 1) throw new Error('slow');
    });
    await analyseHandoffWriter('u1', 'req-1', db).done({ materials: [] });
    const marker = writes.find((w) => w.record.status === 'done' && !('result' in w.record));
    expect(marker?.merge).toBe(true);
  });

  it('a late `started` cannot turn a finished document back into running', async () => {
    // done() landed first (the started write was slow and the race gave up
    // on it). When started's write finally arrives it must fail, not clobber.
    const { db, docs } = fakeDb();
    const handoff = analyseHandoffWriter('u1', 'req-1', db);
    await handoff.done({ materials: [{ name: 'x' }] });
    await handoff.started();
    expect(docs.get('users/u1/analyseRuns/req-1').status).toBe('done');
    expect(docs.get('users/u1/analyseRuns/req-1').result.materials).toHaveLength(1);
  });

  it('a merged marker keeps a payload that landed after the race', async () => {
    // Model the race losing: the payload write "fails" from attempt's point of
    // view but has in fact landed. The marker must not erase the result.
    const { db, docs } = fakeDb((path, record) => {
      if (record.result) {
        docs.set(path, record);
        throw new Error('handoff write timed out');
      }
    });
    await analyseHandoffWriter('u1', 'req-1', db).done({ materials: [{ name: 'x' }] });
    const final = docs.get('users/u1/analyseRuns/req-1');
    expect(final.status).toBe('done');
    expect(final.result.materials).toHaveLength(1);
  });

  it('writes nothing when the kill switch is off, and stays off for the whole run', async () => {
    const { db, writes } = fakeDb(undefined, { analyseHandoff: false });
    const handoff = analyseHandoffWriter('u1', 'req-1', db);
    await handoff.started();
    await handoff.done({ materials: [{ name: 'x' }] });
    await handoff.failed('boom');
    expect(writes).toEqual([]);
  });

  it('treats a missing config document as ON', async () => {
    const { db, writes } = fakeDb(undefined, null);
    const handoff = analyseHandoffWriter('u1', 'req-1', db);
    await handoff.started();
    expect(writes.map((w) => w.record.status)).toEqual(['running']);
  });

  it('swallows a Firestore failure instead of failing the analyse', async () => {
    const { db } = fakeDb(() => {
      throw new Error('doc too large');
    });
    const handoff = analyseHandoffWriter('u1', 'req-1', db);

    await expect(handoff.started()).resolves.toBeUndefined();
    await expect(handoff.done({ materials: [] })).resolves.toBeUndefined();
    await expect(handoff.failed('boom')).resolves.toBeUndefined();
    // started, done, done's marker fallback, failed.
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
