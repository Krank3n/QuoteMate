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

function fakeDb(onSet?: (path: string, record: any) => void) {
  const writes: Array<{ path: string; record: any }> = [];
  const db = () =>
    ({
      doc: (path: string) => ({
        set: async (record: any) => {
          onSet?.(path, record);
          writes.push({ path, record });
        },
      }),
    }) as any;
  return { db, writes };
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
      const db = () => ({ doc: () => ({ set: () => new Promise(() => {}) }) }) as any;
      const pending = analyseHandoffWriter('u1', 'req-1', db).done({ materials: [] });
      await vi.advanceTimersByTimeAsync(HANDOFF_WRITE_TIMEOUT_MS + 10);
      await expect(pending).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        '[analyse handoff] write failed',
        expect.objectContaining({ message: 'handoff write timed out' }),
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

  it('swallows a Firestore failure instead of failing the analyse', async () => {
    const { db } = fakeDb(() => {
      throw new Error('doc too large');
    });
    const handoff = analyseHandoffWriter('u1', 'req-1', db);

    await expect(handoff.started()).resolves.toBeUndefined();
    await expect(handoff.done({ materials: [] })).resolves.toBeUndefined();
    await expect(handoff.failed('boom')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
