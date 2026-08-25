// @vitest-environment jsdom
/**
 * BottomSheet's onClosed contract: it fires exactly once, after the close
 * animation reports finished and never before. RecordPaymentScreen leans on
 * this to goBack() only once the slide-out has played — firing early would
 * pop the navigator while the sheet is still on screen.
 *
 * The close animation is driven through a stubbed Animated.parallel because
 * react-native-web completes real animations instantly under Platform.isTesting
 * — there is no observable mid-close state otherwise. (The open animation also
 * goes through Animated.parallel but starts with no end callback, so the stub
 * only ever captures the close.)
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Animated, Text } from 'react-native';

vi.mock('react-native-paper', () => ({
  Portal: ({ children }: any) => children,
  Text: ({ children }: any) => React.createElement('span', null, children),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { BottomSheet } from './BottomSheet';

type EndCallback = (result: { finished: boolean }) => void;

/** Stub the close animation so the test controls when it ends. */
function stubCloseAnimation() {
  let onEnd: EndCallback | undefined;
  vi.spyOn(Animated, 'parallel').mockReturnValue({
    start: (cb?: EndCallback) => {
      onEnd = cb;
    },
    stop: () => {},
    reset: () => {},
  } as unknown as Animated.CompositeAnimation);
  return { finish: () => act(() => onEnd?.({ finished: true })) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function sheet(visible: boolean, onClosed: () => void) {
  return (
    <BottomSheet visible={visible} onDismiss={() => {}} onClosed={onClosed}>
      <Text>sheet content</Text>
    </BottomSheet>
  );
}

describe('BottomSheet onClosed', () => {
  it('fires exactly once, after the close animation completes, then unmounts', () => {
    const close = stubCloseAnimation();
    const onClosed = vi.fn();
    const { queryByText, rerender } = render(sheet(true, onClosed));
    expect(queryByText('sheet content')).toBeTruthy();

    rerender(sheet(false, onClosed));

    // Close animation is running: still mounted, callback not yet fired.
    expect(queryByText('sheet content')).toBeTruthy();
    expect(onClosed).not.toHaveBeenCalled();

    close.finish();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(queryByText('sheet content')).toBeNull();
  });

  it('does not fire while the sheet stays open', () => {
    stubCloseAnimation();
    const onClosed = vi.fn();
    render(sheet(true, onClosed));
    expect(onClosed).not.toHaveBeenCalled();
  });
});
