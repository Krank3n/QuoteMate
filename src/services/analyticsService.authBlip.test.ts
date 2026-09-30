import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const addDoc = vi.fn(async () => ({}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  addDoc: (...a: unknown[]) => addDoc(...(a as [])),
  serverTimestamp: () => 'ts',
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

type Listener = (u: { uid: string } | null) => void;
const listeners = new Set<Listener>();
const fakeAuth: { currentUser: { uid: string } | null } = { currentUser: null };
vi.mock('../config/firebase', () => ({ auth: fakeAuth, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, cb: Listener) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
}));
const emit = (u: { uid: string } | null) => {
  fakeAuth.currentUser = u;
  for (const cb of [...listeners]) cb(u);
};

// Fresh module per test so the remembered uid doesn't leak between cases.
async function load() {
  vi.resetModules();
  return import('./analyticsService');
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const written = () => addDoc.mock.calls.map((c: any[]) => [c[0], c[1].event]);

describe('trackEvent across the cold-start auth blip', () => {
  beforeEach(() => {
    addDoc.mockClear();
    listeners.clear();
    fakeAuth.currentUser = null;
  });
  afterEach(() => vi.useRealTimers());

  it('writes straight away when a user is signed in', async () => {
    const { trackEvent } = await load();
    fakeAuth.currentUser = { uid: 'u1' };
    trackEvent('app_opened');
    await flush();
    expect(written()).toEqual([['users/u1/events', 'app_opened']]);
  });

  it('holds an event fired while auth is briefly null and writes it when the same user is back', async () => {
    const { trackEvent } = await load();
    fakeAuth.currentUser = { uid: 'u1' };
    trackEvent('auth_bootstrap_started');
    await flush();
    fakeAuth.currentUser = null; // the blip
    trackEvent('trial_expired_banner_shown', {});
    await flush();
    expect(written()).toHaveLength(1);
    emit({ uid: 'u1' });
    await flush();
    expect(written()).toEqual([
      ['users/u1/events', 'auth_bootstrap_started'],
      ['users/u1/events', 'trial_expired_banner_shown'],
    ]);
    expect(listeners.size).toBe(0);
  });

  it('drops it rather than crediting a different account that signs in', async () => {
    const { trackEvent } = await load();
    fakeAuth.currentUser = { uid: 'u1' };
    trackEvent('app_opened');
    await flush();
    fakeAuth.currentUser = null;
    trackEvent('trial_expired_banner_shown', {});
    emit({ uid: 'someone-else' });
    await flush();
    expect(written()).toEqual([['users/u1/events', 'app_opened']]);
  });

  it('gives up after the wait when nobody comes back (a real sign-out)', async () => {
    vi.useFakeTimers();
    const { trackEvent, USER_RESTORE_WAIT_MS } = await load();
    fakeAuth.currentUser = { uid: 'u1' };
    trackEvent('app_opened');
    await vi.advanceTimersByTimeAsync(0);
    fakeAuth.currentUser = null;
    trackEvent('trial_expired_banner_shown', {});
    await vi.advanceTimersByTimeAsync(USER_RESTORE_WAIT_MS + 1);
    emit({ uid: 'u1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(written()).toEqual([['users/u1/events', 'app_opened']]);
    expect(listeners.size).toBe(0);
  });

  it('never waits for a process that has not seen a signed-in user (pre-sign-in stays unattributed)', async () => {
    const { trackEvent } = await load();
    trackEvent('app_opened');
    await flush();
    emit({ uid: 'u1' });
    await flush();
    expect(written()).toEqual([]);
    expect(listeners.size).toBe(0);
  });
});
