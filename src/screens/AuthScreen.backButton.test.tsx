// @vitest-environment jsdom
/**
 * Android Back on the sign-up view.
 *
 * Sign-in and sign-up are one screen behind an `isSignUp` flag, not two
 * routes, so Android had no navigation history to pop: Back from "Create your
 * account" closed the app outright. Reproduced on an emulator (versionCode
 * 170) — Back from sign-up landed on the launcher.
 *
 * Same mock wall as AuthScreen.forgotPassword.test.tsx, plus react-native
 * itself so the handler can be driven as Android.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, fireEvent, screen } from '@testing-library/react';

type BackListener = () => boolean;
const backListeners: BackListener[] = [];
const removeSpy = vi.fn();

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
    BackHandler: {
      addEventListener: (_event: string, cb: BackListener) => {
        backListeners.push(cb);
        return { remove: removeSpy };
      },
    },
  };
});

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../../assets/logo-scaled.png', () => ({ default: 'logo.png' }));

vi.mock('react-native-paper', () => {
  const TextInput: any = ({ label, value, onChangeText, autoComplete }: any) =>
    React.createElement('input', {
      'aria-label': label,
      'data-autocomplete': autoComplete,
      value: value ?? '',
      onChange: (e: any) => onChangeText?.(e.target.value),
    });
  TextInput.Icon = () => null;
  return {
    // src/theme.ts spreads these at import time.
    DefaultTheme: { colors: {} },
    MD3DarkTheme: { colors: {} },
    Text: ({ children }: any) => React.createElement('span', null, children),
    Title: ({ children }: any) => React.createElement('h1', null, children),
    Surface: ({ children }: any) => React.createElement('div', null, children),
    ActivityIndicator: () => null,
    TextInput,
    Button: ({ children, onPress, disabled }: any) =>
      React.createElement('button', { onClick: onPress, disabled }, children),
  };
});

vi.mock('expo-apple-authentication', () => ({
  isAvailableAsync: vi.fn(async () => false),
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
vi.mock('expo-crypto', () => ({
  digestStringAsync: vi.fn(async () => 'hashed'),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  GoogleAuthProvider: class {},
  OAuthProvider: class {
    addScope() {}
  },
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(async () => null),
  signInWithCredential: vi.fn(),
  sendEmailVerification: vi.fn(),
  getAdditionalUserInfo: vi.fn(() => ({ isNewUser: false })),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => 'ts'),
}));
vi.mock('../utils/haptics', () => ({ lightTap: vi.fn(), errorTap: vi.fn() }));
vi.mock('../utils/webAnalytics', () => ({ trackWebEvent: vi.fn() }));
vi.mock('../components/WebContainer', () => ({
  WebContainer: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('../services/nativeGoogleSignIn', () => ({
  signInGetIdToken: vi.fn(),
  statusCodes: {},
}));
vi.mock('../services/googleSignInCore', () => ({
  firebaseSignInWithGoogleIdToken: vi.fn(),
  mapGoogleSignInError: vi.fn(),
  messageForGoogleSignInError: vi.fn(),
}));
vi.mock('../services/passwordResetCore', () => ({
  requestPasswordReset: vi.fn(async () => ({ status: 'sent', message: 'Reset link on its way.' })),
}));

import { AuthScreen } from './AuthScreen';

/**
 * Fire Android's Back the way the OS would, newest listener first. Wrapped in
 * act(): the press arrives from outside React, so the state it sets has to be
 * flushed before the assertions read the tree.
 */
function pressBack(): boolean {
  let handled = false;
  act(() => {
    for (let i = backListeners.length - 1; i >= 0; i--) {
      if (backListeners[i]()) {
        handled = true;
        return;
      }
    }
  });
  return handled;
}

beforeEach(() => {
  vi.clearAllMocks();
  backListeners.length = 0;
});

describe('AuthScreen — Android back button', () => {
  it('returns to sign-in instead of letting the app close', () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Sign Up'));
    expect(screen.getByText('Create your account')).toBeTruthy();

    // Handled here: true stops the press reaching the activity, which is what
    // was closing the app.
    expect(pressBack()).toBe(true);
    expect(screen.getByText('Welcome back')).toBeTruthy();
  });

  it('leaves Back alone on sign-in, where closing the app is correct', () => {
    render(<AuthScreen />);
    expect(screen.getByText('Welcome back')).toBeTruthy();
    // Nothing registered, so the press falls through to the system.
    expect(pressBack()).toBe(false);
  });

  it('unsubscribes when it goes back to sign-in, leaving no stray handler', () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Sign Up'));
    pressBack();
    expect(removeSpy).toHaveBeenCalled();
  });
});
