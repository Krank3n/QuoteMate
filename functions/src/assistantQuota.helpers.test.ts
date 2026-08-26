import { describe, it, expect } from 'vitest';
import {
  QUOTA,
  todayKey,
  reserveTurnUpdate,
  refundTurnUpdate,
  VOICE_HOLD_SECONDS,
  MAX_SESSION_SECONDS,
  remainingVoiceSeconds,
  reserveVoiceSecondsUpdate,
  refundVoiceSecondsUpdate,
  settleVoiceSecondsUpdate,
} from './assistantQuota.helpers';

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

// ---------------------------------------------------------------------------
// Voice minutes
//
// These exist because the cost model changed shape. Gemini Live billed tokens,
// so the turn quota bounded spend on its own. An ElevenLabs Agent bills by the
// minute, so one long conversation can cost real money while the turn counter
// reads 1. Hold-and-settle is what keeps a short question cheap without letting
// a client talk for free.
// ---------------------------------------------------------------------------

describe('reserveVoiceSecondsUpdate', () => {
  it('parks a hold against a missing doc', () => {
    const r = reserveVoiceSecondsUpdate(undefined, 'free');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.update.voiceSeconds).toBe(VOICE_HOLD_SECONDS);
      expect(r.heldSeconds).toBe(VOICE_HOLD_SECONDS);
    }
  });

  it('adds to seconds already spent today', () => {
    const r = reserveVoiceSecondsUpdate({ voiceSeconds: 240 }, 'trial');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.update.voiceSeconds).toBe(240 + VOICE_HOLD_SECONDS);
  });

  it('allows a hold that lands exactly on the limit', () => {
    const used = QUOTA.trial.voiceSeconds - VOICE_HOLD_SECONDS;
    const r = reserveVoiceSecondsUpdate({ voiceSeconds: used }, 'trial');
    expect(r.ok).toBe(true);
  });

  it('refuses one second past the limit', () => {
    const used = QUOTA.trial.voiceSeconds - VOICE_HOLD_SECONDS + 1;
    const r = reserveVoiceSecondsUpdate({ voiceSeconds: used }, 'trial');
    expect(r.ok).toBe(false);
  });

  it('refuses when the budget is nearly gone rather than cutting the tradie off mid-sentence', () => {
    const r = reserveVoiceSecondsUpdate({ voiceSeconds: QUOTA.free.voiceSeconds - 10 }, 'free');
    expect(r.ok).toBe(false);
  });

  it('refuses free where trial still allows, at the same usage', () => {
    const used = QUOTA.free.voiceSeconds;
    expect(reserveVoiceSecondsUpdate({ voiceSeconds: used }, 'free').ok).toBe(false);
    expect(reserveVoiceSecondsUpdate({ voiceSeconds: used }, 'trial').ok).toBe(true);
  });

  it('names the minutes and the reset in the refusal, and offers the text fallback', () => {
    const r = reserveVoiceSecondsUpdate({ voiceSeconds: QUOTA.free.voiceSeconds }, 'free');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain(String(QUOTA.free.voiceSeconds / 60));
      expect(r.reason).toContain('midnight UTC');
      expect(r.reason).toMatch(/type/i);
    }
  });
});

describe('refundVoiceSecondsUpdate', () => {
  it('gives back a hold whose session never opened', () => {
    expect(refundVoiceSecondsUpdate({ voiceSeconds: 300 }, 120)).toEqual({ voiceSeconds: 180 });
  });

  it('returns null when there is nothing to refund', () => {
    expect(refundVoiceSecondsUpdate(undefined, 120)).toBeNull();
    expect(refundVoiceSecondsUpdate({ voiceSeconds: 0 }, 120)).toBeNull();
  });

  it('never goes negative across the midnight-UTC rollover', () => {
    // Reserve landed on yesterday's doc, refund runs against today's fresh one.
    expect(refundVoiceSecondsUpdate({ voiceSeconds: 30 }, 120)).toEqual({ voiceSeconds: 0 });
  });
});

describe('settleVoiceSecondsUpdate', () => {
  it('refunds the unused part of the hold for a short session', () => {
    // Held 120, actually talked for 20 → give back 100.
    const r = settleVoiceSecondsUpdate({ voiceSeconds: 120 }, {
      plan: 'trial', holdSeconds: 120, actualSeconds: 20,
    });
    expect(r).toEqual({ voiceSeconds: 20 });
  });

  it('charges the excess when the session outran the hold', () => {
    const r = settleVoiceSecondsUpdate({ voiceSeconds: 120 }, {
      plan: 'trial', holdSeconds: 120, actualSeconds: 400,
    });
    expect(r).toEqual({ voiceSeconds: 400 });
  });

  it('returns null when the session ran exactly the hold', () => {
    expect(settleVoiceSecondsUpdate({ voiceSeconds: 120 }, {
      plan: 'trial', holdSeconds: 120, actualSeconds: 120,
    })).toBeNull();
  });

  it('clamps a client-reported duration to the plan session ceiling', () => {
    // A misbehaving client claiming an hour on free cannot poison the day.
    const r = settleVoiceSecondsUpdate({ voiceSeconds: 120 }, {
      plan: 'free', holdSeconds: 120, actualSeconds: 3600,
    });
    expect(r).toEqual({ voiceSeconds: MAX_SESSION_SECONDS.free });
  });

  it('treats a negative reported duration as zero', () => {
    const r = settleVoiceSecondsUpdate({ voiceSeconds: 120 }, {
      plan: 'pro', holdSeconds: 120, actualSeconds: -50,
    });
    expect(r).toEqual({ voiceSeconds: 0 });
  });

  it('never drives the day negative when settling against a fresh doc', () => {
    const r = settleVoiceSecondsUpdate({ voiceSeconds: 0 }, {
      plan: 'pro', holdSeconds: 120, actualSeconds: 10,
    });
    expect(r).toEqual({ voiceSeconds: 0 });
  });

  it('rounds fractional seconds rather than storing them', () => {
    const r = settleVoiceSecondsUpdate({ voiceSeconds: 120 }, {
      plan: 'pro', holdSeconds: 120, actualSeconds: 187.6,
    });
    expect(r).toEqual({ voiceSeconds: 188 });
  });
});

describe('remainingVoiceSeconds', () => {
  it('reports the full budget for a fresh day', () => {
    expect(remainingVoiceSeconds(undefined, 'pro')).toBe(QUOTA.pro.voiceSeconds);
  });

  it('subtracts what has been spent', () => {
    expect(remainingVoiceSeconds({ voiceSeconds: 100 }, 'free')).toBe(QUOTA.free.voiceSeconds - 100);
  });

  it('floors at zero rather than reporting a negative allowance', () => {
    expect(remainingVoiceSeconds({ voiceSeconds: 99_999 }, 'free')).toBe(0);
  });
});

describe('voice budget shape', () => {
  it('gives every plan a session ceiling that fits inside its daily budget', () => {
    for (const plan of ['free', 'trial', 'pro'] as const) {
      expect(MAX_SESSION_SECONDS[plan]).toBeLessThanOrEqual(QUOTA[plan].voiceSeconds);
    }
  });

  it('leaves room for at least one full hold on every plan', () => {
    for (const plan of ['free', 'trial', 'pro'] as const) {
      expect(QUOTA[plan].voiceSeconds).toBeGreaterThanOrEqual(VOICE_HOLD_SECONDS);
    }
  });

  it('is more generous the more the user pays', () => {
    expect(QUOTA.free.voiceSeconds).toBeLessThan(QUOTA.trial.voiceSeconds);
    expect(QUOTA.trial.voiceSeconds).toBeLessThanOrEqual(QUOTA.pro.voiceSeconds);
  });

  it('leaves the turn quota exactly as it was', () => {
    expect(QUOTA.free.turns).toBe(20);
    expect(QUOTA.trial.turns).toBe(200);
    expect(QUOTA.pro.turns).toBe(200);
  });
});
