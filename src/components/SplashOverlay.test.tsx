// @vitest-environment jsdom
/**
 * Tests for the animated splash overlay that replaced the old inline
 * logo+spinner block in App.tsx. The contracts that matter:
 *
 *  - while loading it renders (and blocks touches) — this is the frame that
 *    must mirror the native launch screen;
 *  - when loading finishes it does NOT vanish on the next frame — it stays
 *    mounted until the exit fade reports finished (the "elegant opening"),
 *    but lets touches through from the first frame of the reveal;
 *  - an exit interrupted by loading resuming (finished: false) must NOT
 *    unmount it — that's the mid-fade re-show path;
 *  - a post-sign-in data load can bring it back after a completed exit.
 *
 * The exit animation is driven through a stubbed Animated.parallel because
 * react-native-web completes real animations instantly under NODE_ENV=test
 * (Platform.isTesting) — there is no observable mid-fade state otherwise.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Animated } from 'react-native';
import { SplashOverlay } from './SplashOverlay';

type EndCallback = (result: { finished: boolean }) => void;

/** Stub the exit animation so the test controls when (and how) it ends. */
function stubExitAnimation() {
  let onEnd: EndCallback | undefined;
  const spy = vi.spyOn(Animated, 'parallel').mockReturnValue({
    start: (cb?: EndCallback) => {
      onEnd = cb;
    },
    stop: () => {},
    reset: () => {},
  } as unknown as Animated.CompositeAnimation);
  return { spy, finish: (finished: boolean) => act(() => onEnd?.({ finished })) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SplashOverlay', () => {
  it('renders the splash frame and blocks touches while visible', () => {
    const { queryByTestId } = render(<SplashOverlay visible />);
    expect(queryByTestId('splash-overlay')).toBeTruthy();
    expect(queryByTestId('splash-logo')).toBeTruthy();
    // pointer-events auto → the overlay swallows taps meant for the app.
    const overlay = queryByTestId('splash-overlay') as HTMLElement;
    expect(getComputedStyle(overlay).pointerEvents).not.toBe('none');
  });

  it('renders nothing when never visible', () => {
    const { queryByTestId } = render(<SplashOverlay visible={false} />);
    expect(queryByTestId('splash-overlay')).toBeNull();
  });

  it('stays mounted while the exit fade runs, then removes itself', () => {
    const exit = stubExitAnimation();
    const { queryByTestId, rerender } = render(<SplashOverlay visible />);

    rerender(<SplashOverlay visible={false} />);

    // Exit has started: still on screen (fading), but touches already pass
    // through to the app underneath.
    const overlay = queryByTestId('splash-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(getComputedStyle(overlay).pointerEvents).toBe('none');

    exit.finish(true);
    expect(queryByTestId('splash-overlay')).toBeNull();
  });

  it('an interrupted exit (loading resumed mid-fade) keeps it on screen', () => {
    const exit = stubExitAnimation();
    const { queryByTestId, rerender } = render(<SplashOverlay visible />);

    rerender(<SplashOverlay visible={false} />);
    rerender(<SplashOverlay visible />);
    // The stopped exit reports finished: false — must not unmount.
    exit.finish(false);

    const overlay = queryByTestId('splash-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(getComputedStyle(overlay).pointerEvents).not.toBe('none');
  });

  it('comes back for a later load after a completed exit (post-sign-in)', () => {
    const exit = stubExitAnimation();
    const { queryByTestId, rerender } = render(<SplashOverlay visible />);

    rerender(<SplashOverlay visible={false} />);
    exit.finish(true);
    expect(queryByTestId('splash-overlay')).toBeNull();

    rerender(<SplashOverlay visible />);
    expect(queryByTestId('splash-overlay')).toBeTruthy();
    expect(queryByTestId('splash-logo')).toBeTruthy();
  });
});
