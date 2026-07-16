import { describe, expect, it } from 'vitest';
import {
  IDLE_GRACE_MS,
  NUDGE_SEND_ONCE_FIELD,
  SquareNudgeInput,
  squareNudgeVerdict,
} from './squareNudge.helpers';
import { TRIAL_MS } from './subscription.helpers';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-16T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const trialingSub = { isPro: false, trialStartedAt: iso(NOW - 5 * DAY) };
const expiredSub = { isPro: false, trialStartedAt: iso(NOW - TRIAL_MS - 2 * DAY) };
const billedSub = { isPro: true, platform: 'ios', productId: 'quotemate_pro_yearly' };

function input(over: Partial<SquareNudgeInput> = {}): SquareNudgeInput {
  return {
    sub: expiredSub,
    emailState: undefined,
    hasSquareConnection: false,
    connectedAtMs: null,
    hasSquarePayment: false,
    hasSentDoc: false,
    ...over,
  };
}

describe('monetised users are never nudged to start collecting', () => {
  const shapes: Array<[string, any]> = [
    ['billed Pro', billedSub],
    ['bare isPro flag', { isPro: true }],
    ['admin_grant comp', { isPro: true, platform: 'admin_grant' }],
  ];
  for (const [label, sub] of shapes) {
    it(`skips a ${label} in every stall state`, () => {
      expect(
        squareNudgeVerdict(input({ sub, hasSquareConnection: true, connectedAtMs: NOW - 30 * DAY }), NOW)
      ).toBeNull();
      expect(squareNudgeVerdict(input({ sub, hasSentDoc: true }), NOW)).toBeNull();
    });
  }

  it('skips anyone who already collected a Square payment', () => {
    expect(
      squareNudgeVerdict(
        input({ hasSquareConnection: true, connectedAtMs: NOW - 30 * DAY, hasSquarePayment: true }),
        NOW
      )
    ).toBeNull();
  });
});

describe('square_connected_idle', () => {
  it('fires once the grace period passes, exactly at the boundary', () => {
    const base = { hasSquareConnection: true };
    expect(
      squareNudgeVerdict(input({ ...base, connectedAtMs: NOW - IDLE_GRACE_MS + 1000 }), NOW)
    ).toBeNull();
    expect(
      squareNudgeVerdict(input({ ...base, connectedAtMs: NOW - IDLE_GRACE_MS }), NOW)
    ).toBe('square_connected_idle');
  });

  it('unknown connection age counts as old (pre-stamp docs)', () => {
    expect(
      squareNudgeVerdict(input({ hasSquareConnection: true, connectedAtMs: null }), NOW)
    ).toBe('square_connected_idle');
  });

  it('applies to trialing users too (the pitch email skips connected users)', () => {
    expect(
      squareNudgeVerdict(
        input({ sub: trialingSub, hasSquareConnection: true, connectedAtMs: NOW - 10 * DAY }),
        NOW
      )
    ).toBe('square_connected_idle');
  });

  it('send-once', () => {
    expect(
      squareNudgeVerdict(
        input({
          hasSquareConnection: true,
          connectedAtMs: NOW - 30 * DAY,
          emailState: { squareIdleNudgeEmailAt: iso(NOW - DAY) },
        }),
        NOW
      )
    ).toBeNull();
  });
});

describe('square_no_paylink', () => {
  it('fires only for trial-expired users who sent quotes and never connected', () => {
    expect(squareNudgeVerdict(input({ hasSentDoc: true }), NOW)).toBe('square_no_paylink');
  });

  it('never fires for trialing users — trial_square_pitch owns that window', () => {
    expect(squareNudgeVerdict(input({ sub: trialingSub, hasSentDoc: true }), NOW)).toBeNull();
  });

  it('never fires for users who never sent anything (activation is a different problem)', () => {
    expect(squareNudgeVerdict(input({ hasSentDoc: false }), NOW)).toBeNull();
  });

  it('connected users get the idle nudge path, not this one', () => {
    expect(
      squareNudgeVerdict(
        input({ hasSentDoc: true, hasSquareConnection: true, connectedAtMs: NOW - 30 * DAY }),
        NOW
      )
    ).toBe('square_connected_idle');
  });

  it('send-once', () => {
    expect(
      squareNudgeVerdict(
        input({ hasSentDoc: true, emailState: { squareNoPaylinkNudgeEmailAt: iso(NOW - DAY) } }),
        NOW
      )
    ).toBeNull();
  });
});

describe('NUDGE_SEND_ONCE_FIELD', () => {
  it('maps each nudge to a distinct emailState field', () => {
    const fields = Object.values(NUDGE_SEND_ONCE_FIELD);
    expect(new Set(fields).size).toBe(2);
  });
});
