/**
 * Tests for the password-reset request decision logic.
 *
 * Context: Firebase's own reset mail spam-foldered on a live send (29 Jul
 * 2026), so reset links go out over Brevo instead and this module decides what
 * each address receives. The branch that matters most is social-only accounts:
 * they have no password to reset, Firebase sends them nothing, and the silence
 * is what pushed one user into creating a duplicate account.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeResetEmail,
  planPasswordReset,
  describeProviders,
  providerLabel,
  evaluateThrottle,
  RESET_WINDOW_MS,
  RESET_MAX_PER_WINDOW,
  type ThrottleRecord,
} from './passwordReset.helpers';

describe('normalizeResetEmail', () => {
  it('trims and lowercases a valid address', () => {
    expect(normalizeResetEmail('  JakeD@CoastalHVAC.com.au ')).toBe('jaked@coastalhvac.com.au');
  });

  it('rejects a non-string payload', () => {
    expect(normalizeResetEmail(undefined)).toBeNull();
    expect(normalizeResetEmail(42)).toBeNull();
    expect(normalizeResetEmail({ email: 'a@b.co' })).toBeNull();
  });

  it('rejects empty and malformed addresses', () => {
    expect(normalizeResetEmail('')).toBeNull();
    expect(normalizeResetEmail('   ')).toBeNull();
    expect(normalizeResetEmail('jaked@coastalhvac')).toBeNull();
    expect(normalizeResetEmail('not an email')).toBeNull();
  });

  it('rejects an absurdly long address rather than passing it to the SDK', () => {
    expect(normalizeResetEmail('a'.repeat(400) + '@example.com')).toBeNull();
  });
});

describe('planPasswordReset', () => {
  it('sends a reset link for a password account', () => {
    expect(planPasswordReset({ providers: ['password'], disabled: false })).toEqual({ action: 'send-reset' });
  });

  it('sends the social reminder for an Apple-only account', () => {
    expect(planPasswordReset({ providers: ['apple.com'], disabled: false })).toEqual({
      action: 'send-social-reminder',
      providers: ['apple.com'],
    });
  });

  it('sends the social reminder for a Google-only account', () => {
    expect(planPasswordReset({ providers: ['google.com'], disabled: false })).toEqual({
      action: 'send-social-reminder',
      providers: ['google.com'],
    });
  });

  it('prefers the reset link when an account has both password and social', () => {
    expect(planPasswordReset({ providers: ['google.com', 'password'], disabled: false })).toEqual({
      action: 'send-reset',
    });
  });

  it('sends nothing for an unknown address', () => {
    expect(planPasswordReset(null)).toEqual({ action: 'none', reason: 'no-account' });
  });

  it('sends nothing to a disabled account', () => {
    expect(planPasswordReset({ providers: ['password'], disabled: true })).toEqual({
      action: 'none',
      reason: 'disabled',
    });
  });
});

describe('describeProviders', () => {
  it('names a single provider', () => {
    expect(describeProviders(['apple.com'])).toBe('Apple');
  });

  it('joins two providers the way a person would say them', () => {
    expect(describeProviders(['google.com', 'apple.com'])).toBe('Google or Apple');
  });

  it('de-duplicates repeated providers', () => {
    expect(describeProviders(['google.com', 'google.com'])).toBe('Google');
  });

  it('falls back to the raw id for an unmapped provider', () => {
    expect(providerLabel('microsoft.com')).toBe('microsoft.com');
  });
});

describe('evaluateThrottle', () => {
  const NOW = 1_800_000_000_000;

  it('allows the first request and opens a window', () => {
    const { allowed, next } = evaluateThrottle(null, NOW);
    expect(allowed).toBe(true);
    expect(next).toEqual({ count: 1, windowStartMs: NOW });
  });

  it('allows requests up to the cap, incrementing within the same window', () => {
    let record: ThrottleRecord | null = null;
    for (let i = 1; i <= RESET_MAX_PER_WINDOW; i++) {
      const result = evaluateThrottle(record, NOW + i * 1000);
      expect(result.allowed).toBe(true);
      expect(result.next.count).toBe(i);
      record = result.next;
    }
  });

  it('blocks once the cap is reached inside the window', () => {
    const record: ThrottleRecord = { count: RESET_MAX_PER_WINDOW, windowStartMs: NOW };
    const { allowed, next } = evaluateThrottle(record, NOW + 60_000);
    expect(allowed).toBe(false);
    expect(next).toEqual(record); // unchanged — a blocked attempt must not extend the window
  });

  it('opens a fresh window once the old one has elapsed', () => {
    const record: ThrottleRecord = { count: RESET_MAX_PER_WINDOW, windowStartMs: NOW };
    const { allowed, next } = evaluateThrottle(record, NOW + RESET_WINDOW_MS);
    expect(allowed).toBe(true);
    expect(next).toEqual({ count: 1, windowStartMs: NOW + RESET_WINDOW_MS });
  });

  it('does not let a blocked attacker slide the window forward', () => {
    let record: ThrottleRecord = { count: RESET_MAX_PER_WINDOW, windowStartMs: NOW };
    // Hammer it repeatedly just before the window closes.
    for (let i = 0; i < 20; i++) {
      const result = evaluateThrottle(record, NOW + RESET_WINDOW_MS - 1);
      expect(result.allowed).toBe(false);
      record = result.next;
    }
    // The window still expires on schedule.
    expect(evaluateThrottle(record, NOW + RESET_WINDOW_MS).allowed).toBe(true);
  });
});
