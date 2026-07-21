/**
 * Tests for the native Google Sign-In core logic.
 *
 * Regression context: the browser (`expo-auth-session`) Google flow silently
 * failed when the default browser was Firefox — the OAuth redirect never made
 * it back to the app. We moved native sign-in to the native SDK; these tests
 * lock in the result-interpretation and error-mapping that the platform adapter
 * relies on, including the v16 behaviour where cancellation is a *returned*
 * `{ type: 'cancelled' }` rather than a thrown error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authSdk = vi.hoisted(() => ({
  credential: vi.fn((idToken: string) => ({ providerId: 'google.com', idToken })),
  signInWithCredential: vi.fn(async (_auth: unknown, cred: unknown) => ({ user: { uid: 'u1' }, _cred: cred })),
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: authSdk.credential },
  signInWithCredential: authSdk.signInWithCredential,
}));

import {
  interpretSignInResponse,
  mapGoogleSignInError,
  messageForGoogleSignInError,
  firebaseSignInWithGoogleIdToken,
  type GoogleStatusCodes,
} from './googleSignInCore';

const CODES: GoogleStatusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
};

beforeEach(() => {
  authSdk.credential.mockClear();
  authSdk.signInWithCredential.mockClear();
  authSdk.signInWithCredential.mockResolvedValue({ user: { uid: 'u1' } } as never);
});

describe('interpretSignInResponse (v16 signIn() shape)', () => {
  it('returns success + idToken for a successful response', () => {
    const res = { type: 'success', data: { idToken: 'tok-123', user: { id: 'x' } } };
    expect(interpretSignInResponse(res)).toEqual({ status: 'success', idToken: 'tok-123' });
  });

  it('treats a cancelled response as cancelled, not an error — regression for v16 return-based cancel', () => {
    expect(interpretSignInResponse({ type: 'cancelled', data: null })).toEqual({ status: 'cancelled' });
  });

  it('flags a success response whose idToken is null as no-token (never hands null to Firebase)', () => {
    expect(interpretSignInResponse({ type: 'success', data: { idToken: null } })).toEqual({ status: 'no-token' });
  });

  it('flags an empty-string idToken as no-token', () => {
    expect(interpretSignInResponse({ type: 'success', data: { idToken: '' } })).toEqual({ status: 'no-token' });
  });

  it('is defensive against malformed / undefined responses', () => {
    expect(interpretSignInResponse(undefined)).toEqual({ status: 'no-token' });
    expect(interpretSignInResponse(null)).toEqual({ status: 'no-token' });
    expect(interpretSignInResponse({})).toEqual({ status: 'no-token' });
    expect(interpretSignInResponse({ data: {} })).toEqual({ status: 'no-token' });
  });
});

describe('mapGoogleSignInError (thrown SDK errors)', () => {
  it('maps PLAY_SERVICES_NOT_AVAILABLE → no-play-services', () => {
    expect(mapGoogleSignInError({ code: CODES.PLAY_SERVICES_NOT_AVAILABLE }, CODES)).toBe('no-play-services');
  });

  it('maps a defensively-thrown SIGN_IN_CANCELLED → cancelled', () => {
    expect(mapGoogleSignInError({ code: CODES.SIGN_IN_CANCELLED }, CODES)).toBe('cancelled');
  });

  it('maps IN_PROGRESS → in-progress', () => {
    expect(mapGoogleSignInError({ code: CODES.IN_PROGRESS }, CODES)).toBe('in-progress');
  });

  it('maps an unknown code (Android DEVELOPER_ERROR / SHA-1 misconfig) → failed', () => {
    expect(mapGoogleSignInError({ code: 'DEVELOPER_ERROR' }, CODES)).toBe('failed');
    expect(mapGoogleSignInError(new Error('boom'), CODES)).toBe('failed');
    expect(mapGoogleSignInError(undefined, CODES)).toBe('failed');
  });
});

describe('messageForGoogleSignInError', () => {
  it('points the user at email sign-in when Play Services is missing', () => {
    expect(messageForGoogleSignInError('no-play-services')).toMatch(/email/i);
  });

  it('stays silent on user cancel and in-progress (no scary error)', () => {
    expect(messageForGoogleSignInError('cancelled')).toBeNull();
    expect(messageForGoogleSignInError('in-progress')).toBeNull();
  });

  it('shows a generic retry message on failure', () => {
    expect(messageForGoogleSignInError('failed')).toMatch(/try again/i);
  });
});

describe('firebaseSignInWithGoogleIdToken', () => {
  it('builds a Google credential from the idToken and signs into Firebase', async () => {
    const auth = { name: 'auth' } as never;
    const result = await firebaseSignInWithGoogleIdToken(auth, 'tok-abc');

    expect(authSdk.credential).toHaveBeenCalledWith('tok-abc');
    expect(authSdk.signInWithCredential).toHaveBeenCalledTimes(1);
    const [passedAuth, passedCred] = authSdk.signInWithCredential.mock.calls[0];
    expect(passedAuth).toBe(auth);
    expect(passedCred).toEqual({ providerId: 'google.com', idToken: 'tok-abc' });
    expect(result).toMatchObject({ user: { uid: 'u1' } });
  });

  it('propagates Firebase errors (e.g. account-exists-with-different-credential)', async () => {
    authSdk.signInWithCredential.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'auth/account-exists-with-different-credential' }),
    );
    await expect(firebaseSignInWithGoogleIdToken({} as never, 'tok')).rejects.toMatchObject({
      code: 'auth/account-exists-with-different-credential',
    });
  });
});
