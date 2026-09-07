// @vitest-environment jsdom
/**
 * Which GA event a completed authentication emits.
 *
 * `sign_up` is the event the website→account funnel is joined on, so it has
 * to mean one thing: an account that did not exist a moment ago. A returning
 * user emits `login`. Getting this wrong in either direction quietly
 * corrupts every acquisition number downstream — a returning OAuth user
 * counted as a signup inflates conversion for whichever channel they last
 * touched, and website CTA clicks counted as signups inflate all of them.
 *
 * Same mock wall as AuthScreen.signupIntent.test.tsx.
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


import { trackWebEvent } from '../utils/webAnalytics';
import { signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, getAdditionalUserInfo, sendEmailVerification } from 'firebase/auth';

const track = vi.mocked(trackWebEvent);
const popup = vi.mocked(signInWithPopup);
const createUser = vi.mocked(createUserWithEmailAndPassword);
const signIn = vi.mocked(signInWithEmailAndPassword);
const additionalUserInfo = vi.mocked(getAdditionalUserInfo);

const credential = { user: { uid: 'u1' } } as any;

/** Every GA event name emitted, in order. */
function events(): string[] {
  return track.mock.calls.map((call) => call[0] as string);
}

function typeCredentials(emailValue = 'new@example.com') {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: emailValue } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'sixchars' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/app');
  vi.mocked(sendEmailVerification).mockResolvedValue(undefined as never);
  popup.mockResolvedValue(credential);
  createUser.mockResolvedValue(credential);
  signIn.mockResolvedValue(credential);
});

describe('a genuinely new account', () => {
  it('emits exactly one sign_up for a new Google account', async () => {
    additionalUserInfo.mockReturnValue({ isNewUser: true } as any);
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Continue with Google'));
    await vi.waitFor(() => expect(popup).toHaveBeenCalled());
    await vi.waitFor(() => expect(events()).toContain('sign_up'));
    expect(events().filter((e) => e === 'sign_up')).toHaveLength(1);
    expect(events()).not.toContain('login');
    expect(track).toHaveBeenCalledWith('sign_up', { method: 'google' });
  });

  it('emits exactly one sign_up for a new email account', async () => {
    additionalUserInfo.mockReturnValue({ isNewUser: true } as any);
    render(<AuthScreen />);
    // Switch from the default sign-in view to sign-up.
    fireEvent.click(screen.getByText('Sign Up'));
    typeCredentials();
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'sixchars' } });
    fireEvent.click(screen.getByText('Create Account'));
    await vi.waitFor(() => expect(createUser).toHaveBeenCalled());
    await vi.waitFor(() => expect(events()).toContain('sign_up'));
    expect(events().filter((e) => e === 'sign_up')).toHaveLength(1);
    expect(track).toHaveBeenCalledWith('sign_up', { method: 'email' });
  });
});

describe('a returning user', () => {
  it('emits login, never sign_up, for a returning Google account', async () => {
    additionalUserInfo.mockReturnValue({ isNewUser: false } as any);
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Continue with Google'));
    await vi.waitFor(() => expect(popup).toHaveBeenCalled());
    await vi.waitFor(() => expect(events()).toContain('login'));
    expect(events()).not.toContain('sign_up');
    expect(track).toHaveBeenCalledWith('login', { method: 'google' });
  });

  it('emits login, never sign_up, for a returning email sign-in', async () => {
    render(<AuthScreen />);
    typeCredentials('back@example.com');
    fireEvent.click(screen.getByText('Sign In'));
    await vi.waitFor(() => expect(signIn).toHaveBeenCalled());
    await vi.waitFor(() => expect(events()).toContain('login'));
    expect(events()).not.toContain('sign_up');
  });

  it('emits nothing at all when authentication fails', async () => {
    signIn.mockRejectedValue({ code: 'auth/wrong-password' } as never);
    render(<AuthScreen />);
    typeCredentials('back@example.com');
    fireEvent.click(screen.getByText('Sign In'));
    await vi.waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(events()).not.toContain('sign_up');
    expect(events()).not.toContain('login');
  });

  it('treats absent provider metadata as a returning user, not a signup', async () => {
    // getAdditionalUserInfo returns null for some providers/SDK paths. An
    // unknown answer must never be counted as a new account.
    additionalUserInfo.mockReturnValue(null as any);
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Continue with Google'));
    await vi.waitFor(() => expect(popup).toHaveBeenCalled());
    await vi.waitFor(() => expect(events()).toContain('login'));
    expect(events()).not.toContain('sign_up');
  });
});
