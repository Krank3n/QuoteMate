import { describe, it, expect } from 'vitest';
import {
  SQUARE_OAUTH_STATE_TTL_MS,
  hashOAuthState,
  newOAuthState,
  oauthStateVerdict,
} from './squareOAuth.helpers';

const NOW_MS = Date.parse('2026-07-17T00:00:00Z');

describe('newOAuthState / hashOAuthState (PAY-03)', () => {
  it('generates URL-safe nonces with at least 256 bits of entropy encoded', () => {
    const state = newOAuthState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it('generates a different nonce every call', () => {
    expect(newOAuthState()).not.toEqual(newOAuthState());
  });

  it('hashes deterministically and differently per state', () => {
    const a = newOAuthState();
    const b = newOAuthState();
    expect(hashOAuthState(a)).toEqual(hashOAuthState(a));
    expect(hashOAuthState(a)).not.toEqual(hashOAuthState(b));
    expect(hashOAuthState(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('oauthStateVerdict (PAY-03)', () => {
  it('rejects a missing doc — an unknown or already-consumed state is invalid', () => {
    const v = oauthStateVerdict(undefined, NOW_MS);
    expect(v).toEqual({ ok: false, status: 400, error: 'Invalid state parameter' });
  });

  it('rejects a doc without a usable uid', () => {
    expect(oauthStateVerdict({ uid: '', createdAtMs: NOW_MS }, NOW_MS).ok).toBe(false);
    expect(oauthStateVerdict({ uid: 42 as unknown, createdAtMs: NOW_MS }, NOW_MS).ok).toBe(false);
  });

  it('rejects a doc without a numeric createdAtMs', () => {
    const v = oauthStateVerdict({ uid: 'user-1' }, NOW_MS);
    expect(v).toEqual({ ok: false, status: 400, error: 'Authorization expired. Please try again.' });
  });

  it('rejects a state older than the 10-minute TTL', () => {
    const v = oauthStateVerdict(
      { uid: 'user-1', createdAtMs: NOW_MS - SQUARE_OAUTH_STATE_TTL_MS - 1 },
      NOW_MS,
    );
    expect(v).toEqual({ ok: false, status: 400, error: 'Authorization expired. Please try again.' });
  });

  it('accepts a fresh state at the TTL boundary and returns the stored uid', () => {
    const v = oauthStateVerdict(
      { uid: 'user-1', createdAtMs: NOW_MS - SQUARE_OAUTH_STATE_TTL_MS },
      NOW_MS,
    );
    expect(v).toEqual({ ok: true, uid: 'user-1' });
  });
});

describe('oauthStateVerdict ttl override', () => {
  it('honours a longer TTL for flows that legitimately take longer than Square (Google consent)', () => {
    const doc = { uid: 'u1', createdAtMs: NOW_MS - 20 * 60 * 1000 };
    expect(oauthStateVerdict(doc, NOW_MS).ok).toBe(false);
    expect(oauthStateVerdict(doc, NOW_MS, 30 * 60 * 1000)).toEqual({ ok: true, uid: 'u1' });
    expect(oauthStateVerdict({ ...doc, createdAtMs: NOW_MS - 31 * 60 * 1000 }, NOW_MS, 30 * 60 * 1000).ok).toBe(false);
  });
});
