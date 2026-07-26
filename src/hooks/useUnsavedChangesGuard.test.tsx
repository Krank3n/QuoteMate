// @vitest-environment jsdom
/**
 * Regression tests for useUnsavedChangesGuard's stale-action guard.
 *
 * Production Sentry crash: `TypeError: Cannot read properties of undefined
 * (reading 'routes')` from React Navigation's getStateForAction, reached via
 * the imperative navigation.dispatch(...) this hook makes.
 *
 * The hook pauses an in-flight `beforeRemove` action, shows a confirm modal,
 * and — after awaiting onSave/onDiscard — re-dispatches the stored action.
 * During that async gap the navigator (or the whole root tree in App.tsx) can
 * be torn down, so the captured action targets state that no longer exists and
 * dispatch throws synchronously, crashing the app.
 *
 * These tests mount the hook with a mocked navigation whose `dispatch` throws
 * that exact error and assert the discard flow no longer rejects/throws. A
 * second case guards the existing abort-on-validation-failure behavior.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Capture what the hook registers so tests can drive the beforeRemove flow.
let beforeRemoveCb: ((e: any) => void) | null = null;
const dispatch = vi.fn();
const goBack = vi.fn();
const addListener = vi.fn((event: string, cb: (e: any) => void) => {
  if (event === 'beforeRemove') beforeRemoveCb = cb;
  return () => {};
});

vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ addListener, dispatch, goBack }),
}));

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

const fireBeforeRemove = () => {
  const event = { preventDefault: vi.fn(), data: { action: { type: 'GO_BACK' } } };
  act(() => {
    beforeRemoveCb?.(event);
  });
  return event;
};

describe('useUnsavedChangesGuard stale-action guard', () => {
  beforeEach(() => {
    beforeRemoveCb = null;
    dispatch.mockReset();
    goBack.mockReset();
    addListener.mockClear();
  });

  it('does not throw/reject when re-dispatching a stale action crashes', async () => {
    // Simulate the reported crash: the navigator state moved on during the
    // await, so dispatch throws synchronously from getStateForAction.
    dispatch.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'routes')");
    });

    const { result } = renderHook(() =>
      useUnsavedChangesGuard({ isDirty: true, onSave: async () => true })
    );

    fireBeforeRemove();

    await expect(
      result.current.unsavedModalProps.secondaryButtonAction()
    ).resolves.not.toThrow();

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch when onSave returns false (validation abort)', async () => {
    const { result } = renderHook(() =>
      useUnsavedChangesGuard({ isDirty: true, onSave: async () => false })
    );

    fireBeforeRemove();

    await act(async () => {
      await result.current.unsavedModalProps.primaryButtonAction();
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(goBack).not.toHaveBeenCalled();
  });
});
