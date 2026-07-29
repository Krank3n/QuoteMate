/**
 * Tests for the "Forgot password?" core logic.
 *
 * Regression context: AuthScreen had no password-reset affordance, so a
 * locked-out user's only way back in was to create a duplicate account with
 * Google/Apple (Coastal HVAC, Jul 2026).
 *
 * The transport matters as much as the logic here. Firebase's own
 * `sendPasswordResetEmail` mails from `firebaseapp.com` and a live send on
 * 29 Jul 2026 spam-foldered, so this module must go through the
 * `requestPasswordReset` callable (which relays via Brevo) and must never
 * reintroduce the direct SDK call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fns = vi.hoisted(() => ({
  callable: vi.fn(async (_payload: unknown) => ({ data: { ok: true } })),
  httpsCallable: vi.fn(),
  getFunctions: vi.fn(() => ({})),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: fns.getFunctions,
  httpsCallable: (...args: unknown[]) => {
    fns.httpsCallable(...args);
    return fns.callable;
  },
}));

import { requestPasswordReset, RESET_SENT_MESSAGE } from './passwordResetCore';

function callableError(code: string) {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  fns.callable.mockReset();
  fns.httpsCallable.mockReset();
  fns.callable.mockResolvedValue({ data: { ok: true } } as never);
});

describe('requestPasswordReset — input guards', () => {
  it('asks for an email when the field is empty, without calling the backend', async () => {
    const outcome = await requestPasswordReset('');
    expect(outcome.status).toBe('needs-email');
    expect(fns.callable).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only field as empty', async () => {
    const outcome = await requestPasswordReset('   ');
    expect(outcome.status).toBe('needs-email');
    expect(fns.callable).not.toHaveBeenCalled();
  });

  it('rejects a malformed address without calling the backend', async () => {
    const outcome = await requestPasswordReset('jaked@coastalhvac');
    expect(outcome.status).toBe('invalid-email');
    expect(fns.callable).not.toHaveBeenCalled();
  });

  it('normalises case and surrounding whitespace before sending', async () => {
    await requestPasswordReset('  JakeD@CoastalHVAC.com.au  ');
    expect(fns.callable).toHaveBeenCalledWith({ email: 'jaked@coastalhvac.com.au' });
  });
});

describe('requestPasswordReset — transport', () => {
  it('goes through the requestPasswordReset callable, not the Firebase SDK', async () => {
    await requestPasswordReset('jaked@coastalhvac.com.au');
    expect(fns.httpsCallable).toHaveBeenCalledTimes(1);
    expect(fns.httpsCallable.mock.calls[0][1]).toBe('requestPasswordReset');
  });

  it('reports sent when the callable resolves', async () => {
    const outcome = await requestPasswordReset('jaked@coastalhvac.com.au');
    expect(outcome.status).toBe('sent');
    expect(outcome.message).toBe(RESET_SENT_MESSAGE);
  });

  it('tells the user to check junk, since reset mail is the one that gets filtered', () => {
    expect(RESET_SENT_MESSAGE).toMatch(/junk/i);
  });
});

describe('requestPasswordReset — error mapping', () => {
  it('maps an unavailable backend to a connection message', async () => {
    fns.callable.mockRejectedValue(callableError('functions/unavailable') as never);
    const outcome = await requestPasswordReset('someone@example.com');
    expect(outcome.status).toBe('failed');
    expect(outcome.message).toMatch(/connection/i);
  });

  it('falls back to a generic failure for any other callable error', async () => {
    fns.callable.mockRejectedValue(callableError('functions/internal') as never);
    const outcome = await requestPasswordReset('someone@example.com');
    expect(outcome.status).toBe('failed');
    expect(outcome.message).toMatch(/try again/i);
  });

  it('does not throw when the callable rejects with a bare error', async () => {
    fns.callable.mockRejectedValue(new Error('boom') as never);
    const outcome = await requestPasswordReset('someone@example.com');
    expect(outcome.status).toBe('failed');
  });

  it('never distinguishes an unknown address from a real one', async () => {
    // The backend always resolves ok:true regardless of whether the account
    // exists, whether it is social-only, or whether it was throttled. The
    // client must render the same thing in every case.
    const real = await requestPasswordReset('jaked@coastalhvac.com.au');
    const unknown = await requestPasswordReset('nobody-at-all@example.com');
    expect(unknown).toEqual(real);
  });
});
