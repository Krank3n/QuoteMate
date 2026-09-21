/**
 * The activity ping is the "they came back" signal for the return trial and
 * the re-engagement emails. In the week of 14 Sep 2026 it answered 401 on
 * 205 of 274 calls: the dashboard mounted, the ping fired, and there was no
 * Firebase user to sign it yet. These pin the fix — wait for the user, and
 * never send a request that can only be refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const listeners: Array<(u: any) => void> = [];
  return {
    auth: { currentUser: null as any },
    listeners,
    onAuthStateChanged: vi.fn((_auth: any, cb: (u: any) => void) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
  };
});

vi.mock('../config/firebase', () => ({ auth: h.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: h.onAuthStateChanged }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.58' } } }));

import { ACTIVITY_PING_AUTH_WAIT_MS, updateActivityTimestamp, waitForAuthUser } from './emailService';

const user = (uid: string) => ({ uid, getIdToken: vi.fn(async () => `token-for-${uid}`) });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  h.auth.currentUser = null;
  h.listeners.length = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, returnTrial: { granted: false } }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('waitForAuthUser', () => {
  it('answers at once when a user is already there', async () => {
    h.auth.currentUser = user('u1');
    await expect(waitForAuthUser(h.auth as any, 1000)).resolves.toBe(h.auth.currentUser);
    expect(h.onAuthStateChanged).not.toHaveBeenCalled();
  });

  it('waits for the user Firebase produces later, and stops listening', async () => {
    const p = waitForAuthUser(h.auth as any, 5000);
    expect(h.listeners).toHaveLength(1);
    h.listeners[0](null); // the transient null a cold start emits first
    const u = user('u2');
    h.listeners[0](u);
    await expect(p).resolves.toBe(u);
    expect(h.listeners).toHaveLength(0);
  });

  it('gives up after the timeout when nobody signs in', async () => {
    const p = waitForAuthUser(h.auth as any, 5000);
    vi.advanceTimersByTime(5000);
    await expect(p).resolves.toBeNull();
    expect(h.listeners).toHaveLength(0);
  });
});

describe('updateActivityTimestamp', () => {
  it('sends the ping with the bearer token once the user is known', async () => {
    const p = updateActivityTimestamp();
    await Promise.resolve();
    h.listeners[0](user('u3'));
    const result = await p;
    expect(result).toEqual({ success: true, returnTrial: { granted: false } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer token-for-u3');
    expect(JSON.parse(init.body)).toEqual({ appVersion: '1.58', appPlatform: 'ios', supportsReturnTrial: true });
  });

  it('never sends a request it knows will be refused', async () => {
    const p = updateActivityTimestamp();
    vi.advanceTimersByTime(ACTIVITY_PING_AUTH_WAIT_MS);
    await expect(p).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still resolves null, never throws, when the send fails', async () => {
    h.auth.currentUser = user('u4');
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(updateActivityTimestamp()).resolves.toBeNull();
  });
});
