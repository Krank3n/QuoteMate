import { describe, it, expect } from 'vitest';
import { QUOTA, todayKey, reserveTurnUpdate, refundTurnUpdate } from './assistantQuota.helpers';

describe('reserveTurnUpdate', () => {
  it('reserves the first turn of the day from a missing doc', () => {
    const r = reserveTurnUpdate(undefined, 'free');
    expect(r).toEqual({
      ok: true,
      update: { turns: 1, outputTokens: 0, inputTokens: 0, plan: 'free' },
    });
  });

  it('increments turns and preserves token counters', () => {
    const r = reserveTurnUpdate({ turns: 5, outputTokens: 1234, inputTokens: 567 }, 'pro');
    expect(r).toEqual({
      ok: true,
      update: { turns: 6, outputTokens: 1234, inputTokens: 567, plan: 'pro' },
    });
  });

  it('allows exactly up to the plan limit', () => {
    const r = reserveTurnUpdate({ turns: QUOTA.free.turns - 1 }, 'free');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.update.turns).toBe(QUOTA.free.turns);
  });

  it('rejects past the limit with the user-facing reason', () => {
    const r = reserveTurnUpdate({ turns: QUOTA.free.turns }, 'free');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain(`${QUOTA.free.turns} turns`);
      expect(r.reason).toContain('midnight UTC');
    }
  });

  it('applies per-plan limits (trial and pro get more than free)', () => {
    expect(reserveTurnUpdate({ turns: QUOTA.free.turns }, 'trial').ok).toBe(true);
    expect(reserveTurnUpdate({ turns: QUOTA.trial.turns }, 'trial').ok).toBe(false);
    expect(reserveTurnUpdate({ turns: QUOTA.pro.turns - 1 }, 'pro').ok).toBe(true);
  });
});

describe('refundTurnUpdate', () => {
  it('gives back one reserved turn', () => {
    expect(refundTurnUpdate({ turns: 3 })).toEqual({ turns: 2 });
    expect(refundTurnUpdate({ turns: 1 })).toEqual({ turns: 0 });
  });

  it('never goes negative — nothing to refund on a fresh or empty doc', () => {
    // Covers the midnight-UTC edge: reserve lands on yesterday's doc, the
    // refund runs after rollover against today's fresh one.
    expect(refundTurnUpdate(undefined)).toBeNull();
    expect(refundTurnUpdate({})).toBeNull();
    expect(refundTurnUpdate({ turns: 0 })).toBeNull();
  });
});

describe('todayKey', () => {
  it('formats the UTC date as yyyymmdd with zero padding', () => {
    expect(todayKey(new Date('2026-07-09T10:00:00Z'))).toBe('20260709');
    expect(todayKey(new Date('2026-01-02T00:00:00Z'))).toBe('20260102');
  });

  it('rolls the day at midnight UTC, not local time', () => {
    expect(todayKey(new Date('2026-07-09T23:59:59Z'))).toBe('20260709');
    expect(todayKey(new Date('2026-07-10T00:00:01Z'))).toBe('20260710');
  });
});
