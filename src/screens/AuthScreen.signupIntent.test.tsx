// @vitest-environment jsdom
/**
 * Signup intent from the marketing site.
 *
 * Every acquisition CTA on quotemateapp.au pointed at a bare /app, and this
 * screen opens on sign-in, so "Get my first quote" landed a first-time
 * visitor on "Welcome back" — the signup→trial step of the funnel starting
 * with a screen addressed to somebody else. The CTAs now carry ?signup=1.
 *
 * Same mock wall as AuthScreen.backButton.test.tsx, running as web so the
 * query string is read at all.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Platform: { OS: 'web', select: (o: any) => o.web ?? o.default },
    BackHandler: { addEventListener: () => ({ remove: () => {} }) },
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

/** Put the app at a URL the way a click from the marketing site would. */
function landOn(url: string) {
  window.history.replaceState({}, '', url);
}

beforeEach(() => {
  vi.clearAllMocks();
  landOn('/app');
});

describe('AuthScreen — signup intent from the website', () => {
  it('opens on Create your account when a marketing CTA sends ?signup=1', () => {
    landOn('/app?signup=1');
    render(<AuthScreen />);
    expect(screen.getByText('Create your account')).toBeTruthy();
    expect(screen.queryByText('Welcome back')).toBeNull();
  });

  it('still opens on Create your account once AttributionBridge appends ad params', () => {
    landOn('/app?signup=1&utm_source=facebook&utm_medium=paid&fbclid=IwAR123');
    render(<AuthScreen />);
    expect(screen.getByText('Create your account')).toBeTruthy();
  });

  it('opens on sign-in for the site\'s Log in links, which carry no intent', () => {
    landOn('/app');
    render(<AuthScreen />);
    expect(screen.getByText('Welcome back')).toBeTruthy();
  });

  it('opens on sign-in for an ad click with no signup intent', () => {
    landOn('/app?utm_source=facebook&fbclid=IwAR123');
    render(<AuthScreen />);
    expect(screen.getByText('Welcome back')).toBeTruthy();
  });

  it('leaves the switch working, so a returning user is one tap from sign-in', () => {
    landOn('/app?signup=1');
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Sign In'));
    expect(screen.getByText('Welcome back')).toBeTruthy();
  });
});
