// @vitest-environment jsdom
/**
 * The allowlist exists for one specific job: shooting Apple's flow recordings
 * on a Release build before the publishing entitlement lands.
 *
 * The danger it avoids is real. A Release build has no `__DEV__` bypass, so the
 * only other way to film would be flipping `ios: true` globally — and every
 * tradie on an App Store build has no entitlement at all, so they would be
 * shown a payment control that fails at authorize() in front of a customer.
 * These tests pin the two halves: the named user gets in, and nobody else does.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const env = vi.hoisted(() => ({
  uid: 'tom-uid' as string | null,
  email: 'shoot@example.com' as string | null,
  flag: {} as Record<string, unknown>,
  capable: true,
}));

vi.mock('../../config/firebase', () => ({
  auth: {
    get currentUser() {
      return env.uid ? { uid: env.uid, email: env.email } : null;
    },
  },
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => env.flag })),
}));

vi.mock('../../services/squarePayments', () => ({
  isTapToPayCapable: vi.fn(async () => env.capable),
}));

vi.mock('../../services/tapToPayErrors', () => ({
  isTapToPayOsSupported: () => true,
  MIN_TAP_TO_PAY_IOS_VERSION: '17.6',
}));

vi.mock('react-native', async () => {
  const actual = await vi.importActual<any>('react-native');
  return { ...actual, Platform: { ...actual.Platform, OS: 'ios' } };
});

import { useTapToPayEnabled } from '../useTapToPayEnabled';

function Probe() {
  const { enabled, reason } = useTapToPayEnabled();
  return <span data-testid="s">{`${enabled}:${reason}`}</span>;
}
const read = (el: HTMLElement) => el.querySelector('[data-testid="s"]')?.textContent;

beforeEach(() => {
  env.uid = 'tom-uid';
  env.email = 'shoot@example.com';
  env.flag = {};
  env.capable = true;
  vi.clearAllMocks();
});

describe('the Release-build allowlist', () => {
  it('lets a named uid through while the global iOS flag stays off', async () => {
    env.flag = { ios: false, allowUserIds: ['tom-uid'] };
    const { container } = render(<Probe />);
    await waitFor(() => expect(read(container)).toBe('true:ready'));
  });

  it('keeps everyone else out — this must not become a global switch', async () => {
    env.flag = { ios: false, allowUserIds: ['someone-else'] };
    const { container } = render(<Probe />);
    await waitFor(() => expect(read(container)).toBe('false:pending_apple'));
  });

  it('stays shut with no allowlist at all', async () => {
    env.flag = { ios: false };
    const { container } = render(<Probe />);
    await waitFor(() => expect(read(container)).toBe('false:pending_apple'));
  });

  it('stays shut for a signed-out user even if the list is non-empty', async () => {
    env.uid = null;
    env.flag = { ios: false, allowUserIds: ['tom-uid'] };
    const { container } = render(<Probe />);
    await waitFor(() => expect(read(container)).toBe('false:pending_apple'));
  });

  it('survives a malformed allowlist rather than throwing', async () => {
    env.flag = { ios: false, allowUserIds: 'tom-uid' };
    const { container } = render(<Probe />);
    await waitFor(() => expect(read(container)).toBe('false:pending_apple'));
  });

  it('matches on email, for the account that does not exist until filming starts', async () => {
    env.flag = { ios: false, allowEmails: ['shoot@example.com'] };
    const { container } = render(<Probe />);
    await waitFor(() => expect(read(container)).toBe('true:ready'));
  });

  it('matches email case-insensitively, so a capitalised sign-up still works', async () => {
    env.email = 'Shoot@Example.com';
    env.flag = { ios: false, allowEmails: ['shoot@example.com'] };
    const { container } = render(<Probe />);
    await waitFor(() => expect(read(container)).toBe('true:ready'));
  });

  it('does not let a different email in', async () => {
    env.flag = { ios: false, allowEmails: ['someone@else.com'] };
    const { container } = render(<Probe />);
    await waitFor(() => expect(read(container)).toBe('false:pending_apple'));
  });

  it('still defers to the device — an allowlist cannot conjure hardware', async () => {
    env.flag = { ios: false, allowUserIds: ['tom-uid'] };
    env.capable = false;
    const { container } = render(<Probe />);
    await waitFor(() => expect(read(container)).toBe('false:unsupported_device'));
  });
});
