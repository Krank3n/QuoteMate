// @vitest-environment jsdom
/**
 * Regression tests for the "Forgot password?" affordance on AuthScreen.
 *
 * The bug this guards is the absence of a control: AuthScreen shipped with no
 * password-reset link at all, so a locked-out tradie's only route back in was
 * to sign up again with Google/Apple, stranding their jobs on the original
 * account (Coastal HVAC, Jul 2026). "The link renders in sign-in mode and
 * actually calls the reset" is therefore the assertion that matters — a unit
 * test of the core logic alone would still have passed with nothing wired up.
 *
 * Heavy native/expo dependency graphs are mocked out — same approach as
 * TakePaymentSheet.test.tsx / StickyJobActionBar.test.tsx.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';

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
import { requestPasswordReset } from '../services/passwordResetCore';
import { trackWebEvent } from '../utils/webAnalytics';

const mockedReset = vi.mocked(requestPasswordReset);

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value } });
}

function forgotButton() {
  return screen.queryByText('Forgot password?');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedReset.mockResolvedValue({ status: 'sent', message: 'Reset link on its way.' } as never);
});

describe('AuthScreen — Forgot password link', () => {
  it('renders the link in sign-in mode', () => {
    render(<AuthScreen />);
    expect(forgotButton()).toBeTruthy();
  });

  it('hides the link in sign-up mode, where resetting makes no sense', () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Sign Up'));
    expect(forgotButton()).toBeNull();
  });

  it('passes the typed email through to the reset request', async () => {
    render(<AuthScreen />);
    typeEmail('jaked@coastalhvac.com.au');
    fireEvent.click(forgotButton()!);

    await waitFor(() => expect(mockedReset).toHaveBeenCalledTimes(1));
    expect(mockedReset.mock.calls[0][0]).toBe('jaked@coastalhvac.com.au');
  });

  it('shows the returned message as a notice when the reset is accepted', async () => {
    mockedReset.mockResolvedValue({ status: 'sent', message: 'Check your inbox, mate.' } as never);
    render(<AuthScreen />);
    typeEmail('jaked@coastalhvac.com.au');
    fireEvent.click(forgotButton()!);

    await waitFor(() => expect(screen.getByText('Check your inbox, mate.')).toBeTruthy());
  });

  it('shows an error when the email field is empty rather than sending blind', async () => {
    mockedReset.mockResolvedValue({ status: 'needs-email', message: 'Pop your email address in first.' } as never);
    render(<AuthScreen />);
    fireEvent.click(forgotButton()!);

    await waitFor(() => expect(screen.getByText('Pop your email address in first.')).toBeTruthy());
  });

  it('surfaces a rate-limit failure as an error, not a success notice', async () => {
    mockedReset.mockResolvedValue({ status: 'rate-limited', message: 'Too many attempts.' } as never);
    render(<AuthScreen />);
    typeEmail('jaked@coastalhvac.com.au');
    fireEvent.click(forgotButton()!);

    await waitFor(() => expect(screen.getByText('Too many attempts.')).toBeTruthy());
    expect(trackWebEvent).not.toHaveBeenCalledWith('password_reset_requested');
  });

  it('tracks a funnel event when the reset is accepted', async () => {
    render(<AuthScreen />);
    typeEmail('jaked@coastalhvac.com.au');
    fireEvent.click(forgotButton()!);

    await waitFor(() => expect(trackWebEvent).toHaveBeenCalledWith('password_reset_requested'));
  });
});
