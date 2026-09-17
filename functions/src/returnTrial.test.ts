/**
 * The Firestore side of the return trial, against a fake store that
 * enforces the Admin SDK's transaction contract (every read before any
 * write) and records exactly what was written and how.
 */
import { describe, it, expect } from 'vitest';
import { recordReturnAndMaybeGrantTrial, ReturnTrialStore } from './returnTrial';
import { RETURN_TRIAL_DAYS } from './returnTrial.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-17T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

interface Write { path: string; data: Record<string, unknown>; merge: boolean }

function fakeStore(docs: Record<string, Record<string, unknown> | undefined>) {
  const writes: Write[] = [];
  const reads: string[] = [];
  let wroteAlready = false;
  const store: ReturnTrialStore = {
    doc: (path) => ({ path } as any),
    runTransaction: async (fn) => {
      const tx = {
        get: async (ref: any) => {
          if (wroteAlready) throw new Error('Firestore transactions require all reads to be executed before all writes.');
          reads.push(ref.path);
          const data = docs[ref.path];
          return { exists: data !== undefined, data: () => data } as any;
        },
        set: (ref: any, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          wroteAlready = true;
          writes.push({ path: ref.path, data, merge: !!opts?.merge });
          return tx;
        },
      };
      return fn(tx as any);
    },
  };
  return { store, writes, reads };
}

const ES = 'users/u1/settings/emailState';
const SUB = 'users/u1/profile/subscription';
const stamp = { lastActivityAt: 'SERVER_TS', appVersion: '1.57.0' };
const lapsedSub = { isPro: false, trialStartedAt: iso(NOW - 60 * DAY_MS), quotesThisMonth: 4 };

describe('recordReturnAndMaybeGrantTrial', () => {
  it('recently active: one read, one merge write, sub doc never read', async () => {
    const f = fakeStore({ [ES]: { lastActivityAt: iso(NOW - 3 * DAY_MS) }, [SUB]: lapsedSub });
    const result = await recordReturnAndMaybeGrantTrial(
      { uid: 'u1', activityPatch: stamp, consider: true, nowMs: NOW },
      f.store,
    );
    expect(result).toEqual({ granted: false, days: RETURN_TRIAL_DAYS, reason: 'recently-active' });
    expect(f.reads).toEqual([ES]);
    expect(f.writes).toEqual([{ path: ES, data: { ...stamp, returnTrialClockAt: iso(NOW) }, merge: true }]);
  });

  it('away 45 days on a lapsed trial, supporting bundle: stamp + merge-grant, reads before writes', async () => {
    const f = fakeStore({ [ES]: { lastActivityAt: iso(NOW - 45 * DAY_MS) }, [SUB]: lapsedSub });
    const result = await recordReturnAndMaybeGrantTrial(
      { uid: 'u1', activityPatch: stamp, consider: true, nowMs: NOW },
      f.store,
    );
    expect(result).toEqual({ granted: true, days: RETURN_TRIAL_DAYS });
    expect(f.reads).toEqual([ES, SUB]);
    expect(f.writes).toHaveLength(2);
    expect(f.writes[0]).toEqual({ path: ES, data: { ...stamp, returnTrialClockAt: iso(NOW) }, merge: true });
    expect(f.writes[1].path).toBe(SUB);
    expect(f.writes[1].merge).toBe(true);
    expect(f.writes[1].data).toMatchObject({
      trialEndsAt: iso(NOW + RETURN_TRIAL_DAYS * DAY_MS),
      returnTrialGrantedAt: iso(NOW),
      trialExpired: false,
    });
    // Merge, never overwrite: the quota fields on the doc are not in the patch.
    expect(f.writes[1].data).not.toHaveProperty('quotesThisMonth');
    expect(f.writes[1].data).not.toHaveProperty('trialStartedAt');
  });

  it('same account from an unsupported bundle: stamp written, clock held, nothing granted', async () => {
    const f = fakeStore({ [ES]: { lastActivityAt: iso(NOW - 45 * DAY_MS) }, [SUB]: lapsedSub });
    const result = await recordReturnAndMaybeGrantTrial(
      { uid: 'u1', activityPatch: stamp, consider: false, nowMs: NOW },
      f.store,
    );
    expect(result).toEqual({ granted: false, days: RETURN_TRIAL_DAYS, reason: 'client-unsupported' });
    expect(f.writes).toEqual([
      { path: ES, data: { ...stamp, returnTrialClockAt: iso(NOW - 45 * DAY_MS) }, merge: true },
    ]);
  });

  it('no emailState and no sub doc at all: stamp only, no crash', async () => {
    const f = fakeStore({});
    const result = await recordReturnAndMaybeGrantTrial(
      { uid: 'u1', activityPatch: stamp, consider: true, nowMs: NOW },
      f.store,
    );
    expect(result.granted).toBe(false);
    expect(result.reason).toBe('no-trial');
    expect(f.reads).toEqual([ES, SUB]);
    expect(f.writes).toEqual([{ path: ES, data: { ...stamp, returnTrialClockAt: iso(NOW) }, merge: true }]);
  });
});
