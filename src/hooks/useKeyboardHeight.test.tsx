// @vitest-environment jsdom
/**
 * The hook the modals use instead of a KeyboardAvoidingView. Verified on an
 * Android emulator (5 Sep 2026) after a controller KAV inside the send modal
 * latched its padding and never released it — see the hook's own note.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Handler = (e?: { endCoordinates?: { height?: number } }) => void;
const handlers = new Map<string, Handler>();
const removed: string[] = [];

vi.mock('react-native', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-native');
  return {
    ...actual,
    Platform: { ...(actual.Platform as object), OS: 'android' },
    Keyboard: {
      addListener: (event: string, handler: Handler) => {
        handlers.set(event, handler);
        return { remove: () => removed.push(event) };
      },
    },
  };
});

const { useKeyboardHeight } = await import('./useKeyboardHeight');

const show = (height?: number) =>
  act(() => handlers.get('keyboardDidShow')?.({ endCoordinates: { height } }));
const hide = () => act(() => handlers.get('keyboardDidHide')?.());

beforeEach(() => {
  handlers.clear();
  removed.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe('useKeyboardHeight', () => {
  it('starts at zero — nothing is covered until the keyboard opens', () => {
    const { result } = renderHook(() => useKeyboardHeight());
    expect(result.current).toBe(0);
  });

  it('reports the keyboard height while it is up', () => {
    const { result } = renderHook(() => useKeyboardHeight());
    show(726);
    expect(result.current).toBe(726);
  });

  it('RELEASES the height when the keyboard hides — the bug that made this hook exist', () => {
    const { result } = renderHook(() => useKeyboardHeight());
    show(726);
    hide();
    expect(result.current).toBe(0);
  });

  it('survives a second open after a close', () => {
    const { result } = renderHook(() => useKeyboardHeight());
    show(726);
    hide();
    show(540);
    expect(result.current).toBe(540);
  });

  it('treats a junk height as no keyboard rather than padding by NaN', () => {
    const { result } = renderHook(() => useKeyboardHeight());
    show(Number.NaN);
    expect(result.current).toBe(0);
    show(-5);
    expect(result.current).toBe(0);
    act(() => handlers.get('keyboardDidShow')?.({}));
    expect(result.current).toBe(0);
  });

  it('subscribes to the Android events and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useKeyboardHeight());
    expect([...handlers.keys()].sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
    unmount();
    expect(removed.sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
  });
});
