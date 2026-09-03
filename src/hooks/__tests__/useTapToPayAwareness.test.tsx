// @vitest-environment jsdom
/**
 * Apple reqs 3.1 / 3.3 — the wiring around the awareness decision.
 *
 * The pure rules live in tapToPayAwareness.test.ts. What is worth covering here
 * is everything that can go wrong around them: a Square status call that fails,
 * a dismissal that has to outlive the session, and the ordering that stops an
 * Android phone paying for a network round trip to be told about an iPhone
 * feature.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => ({
  os: 'ios' as string,
  enabled: true,
  connected: true,
  termsAccepted: false,
  stored: null as string | null,
  setItem: vi.fn(async () => {}),
  connectionThrows: false,
}));

vi.mock('react-native', async () => {
  const actual = await vi.importActual<any>('react-native');
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return state.os;
      },
    },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => state.stored),
    setItem: state.setItem,
  },
}));

vi.mock('../useTapToPayEnabled', () => ({
  useTapToPayEnabled: () => ({
    enabled: state.enabled,
    reason: state.enabled ? 'ready' : 'unsupported_device',
  }),
}));

vi.mock('../../services/squarePayments', () => ({
  isTapToPayTermsAccepted: vi.fn(async () => state.termsAccepted),
}));

const checkSquareConnection = vi.hoisted(() =>
  vi.fn(async () => {
    if (state.connectionThrows) throw new Error('offline');
    return { connected: state.connected };
  }),
);
vi.mock('../../services/squareService', () => ({ checkSquareConnection }));

import { useTapToPayAwareness } from '../useTapToPayAwareness';

function Probe() {
  const { visible, dismiss } = useTapToPayAwareness();
  return (
    <div>
      <span data-testid="visible">{visible ? 'yes' : 'no'}</span>
      <button onClick={dismiss}>dismiss</button>
    </div>
  );
}

const shown = (el: HTMLElement) =>
  el.querySelector('[data-testid="visible"]')?.textContent;

beforeEach(() => {
  state.os = 'ios';
  state.enabled = true;
  state.connected = true;
  state.termsAccepted = false;
  state.stored = null;
  state.connectionThrows = false;
  vi.clearAllMocks();
});

describe('useTapToPayAwareness', () => {
  it('shows for an eligible iPhone merchant', async () => {
    const { container } = render(<Probe />);
    await waitFor(() => expect(shown(container)).toBe('yes'));
  });

  it('stays hidden once the terms have been accepted', async () => {
    state.termsAccepted = true;
    const { container } = render(<Probe />);
    await waitFor(() => expect(checkSquareConnection).toHaveBeenCalled());
    expect(shown(container)).toBe('no');
  });

  it('stays hidden when a previous dismissal is stored', async () => {
    state.stored = String(1_700_000_000_000);
    const { container } = render(<Probe />);
    await waitFor(() => expect(checkSquareConnection).toHaveBeenCalled());
    expect(shown(container)).toBe('no');
  });

  it('persists a dismissal so it outlives the session', async () => {
    const { container } = render(<Probe />);
    await waitFor(() => expect(shown(container)).toBe('yes'));

    fireEvent.click(container.querySelector('button')!);

    expect(shown(container)).toBe('no');
    await waitFor(() =>
      expect(state.setItem).toHaveBeenCalledWith(
        'tapToPayAwarenessDismissedAt',
        expect.any(String),
      ),
    );
  });

  it('never asks Square anything on Android', async () => {
    state.os = 'android';
    const { container } = render(<Probe />);
    await waitFor(() => expect(shown(container)).toBe('no'));
    expect(checkSquareConnection).not.toHaveBeenCalled();
  });

  it('skips the round trip entirely when the device is ineligible', async () => {
    state.enabled = false;
    const { container } = render(<Probe />);
    await waitFor(() => expect(shown(container)).toBe('no'));
    expect(checkSquareConnection).not.toHaveBeenCalled();
  });

  it('fails closed when the Square status call blows up', async () => {
    state.connectionThrows = true;
    const { container } = render(<Probe />);
    await waitFor(() => expect(checkSquareConnection).toHaveBeenCalled());
    // No connection known means the CTA could dead-end — better to say nothing.
    expect(shown(container)).toBe('no');
  });

  it('treats an unparseable stored value as dismissed, not as absent', async () => {
    // A bad write must not resurrect the banner on every launch.
    state.stored = 'not-a-number';
    const { container } = render(<Probe />);
    await waitFor(() => expect(checkSquareConnection).toHaveBeenCalled());
    expect(shown(container)).toBe('no');
  });
});
