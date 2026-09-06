/**
 * The launch gate reads Firebase's own persistence record to decide whether a
 * session is worth waiting for, because nothing the SDK exposes can tell its
 * premature startup `null` apart from a real sign-out. If this key stops
 * matching what the SDK writes, the gate silently reverts to showing the
 * sign-in screen to signed-in tradies on every Android cold start — the exact
 * bug it exists to prevent, and one that no other test would catch.
 *
 * The literal below is the key observed in the app's own AsyncStorage on an
 * API 36 emulator, 6 Sep 2026 (dumped via run-as from databases/RKStorage).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  initializeAuth: vi.fn(() => ({})),
  setPersistence: vi.fn(),
  browserLocalPersistence: {},
  getReactNativePersistence: vi.fn(() => ({})),
}));
vi.mock('firebase/firestore', () => ({ getFirestore: vi.fn(() => ({})) }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(() => ({})) }));
vi.mock('firebase/storage', () => ({ getStorage: vi.fn(() => ({})) }));

import { AUTH_PERSISTENCE_KEY } from './firebase';

describe('AUTH_PERSISTENCE_KEY', () => {
  it('matches the key the Firebase SDK actually writes on this project', () => {
    expect(AUTH_PERSISTENCE_KEY).toBe(
      'firebase:authUser:AIzaSyBACasUs7AwAQt_5VcfnEjBRan7AvAM5lw:[DEFAULT]',
    );
  });

  it('keeps the SDK’s shape: firebase:authUser:{apiKey}:{appName}', () => {
    expect(AUTH_PERSISTENCE_KEY).toMatch(/^firebase:authUser:[^:]+:\[DEFAULT\]$/);
  });

  it('carries a real API key, not an empty interpolation', () => {
    // A missing config would produce "firebase:authUser::[DEFAULT]", which
    // reads as "no session" for everyone and brings the flash straight back.
    const apiKey = AUTH_PERSISTENCE_KEY.split(':')[2];
    expect(apiKey.length).toBeGreaterThan(10);
  });
});
