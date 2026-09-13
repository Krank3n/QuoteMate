// @vitest-environment jsdom
/**
 * Regression: the readiness hook used to start at 'preparing' and stay there
 * whenever it was inactive, so a disabled Tap to Pay row (entitlement pending
 * with Apple — every tradie, Sep 2026) rendered a spinner that never stopped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const observer = vi.hoisted(() => ({
  cb: null as null | ((r: string) => void),
  stops: 0,
}));
vi.mock('../services/squarePayments', () => ({
  observeTapToPayReadiness: vi.fn((cb: (r: string) => void) => {
    observer.cb = cb;
    return () => {
      observer.stops += 1;
    };
  }),
}));

import { useTapToPayReadiness } from './useTapToPayReadiness';
import * as squarePayments from '../services/squarePayments';

beforeEach(() => {
  observer.cb = null;
  observer.stops = 0;
  vi.clearAllMocks();
});

describe('useTapToPayReadiness', () => {
  it('is idle, with no label and no subscription, while inactive', () => {
    const { result } = renderHook(() => useTapToPayReadiness(false));
    expect(result.current.readiness).toBe('idle');
    expect(result.current.label).toBeNull();
    expect(squarePayments.observeTapToPayReadiness).not.toHaveBeenCalled();
  });

  it('reports preparing (with the Apple 3.9.1 label) only once active, then follows the reader', () => {
    const { result } = renderHook(() => useTapToPayReadiness(true));
    expect(result.current.readiness).toBe('preparing');
    expect(result.current.label).toMatch(/not ready to take a card yet/);
    act(() => observer.cb?.('ready'));
    expect(result.current.readiness).toBe('ready');
    expect(result.current.label).toBeNull();
  });

  it('drops back to idle and unsubscribes when the sheet closes, and starts fresh on re-open', () => {
    const { result, rerender } = renderHook(({ active }) => useTapToPayReadiness(active), {
      initialProps: { active: true },
    });
    act(() => observer.cb?.('ready'));
    expect(result.current.readiness).toBe('ready');

    rerender({ active: false });
    expect(result.current.readiness).toBe('idle');
    expect(observer.stops).toBe(1);

    rerender({ active: true });
    // Not the stale 'ready' from the previous session.
    expect(result.current.readiness).toBe('preparing');
    expect(squarePayments.observeTapToPayReadiness).toHaveBeenCalledTimes(2);
  });
});
