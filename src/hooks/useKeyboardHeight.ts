/**
 * How much of the screen the keyboard is covering, for content inside a
 * react-native <Modal>.
 *
 * Why not react-native-keyboard-controller's KeyboardAvoidingView, which every
 * full screen in this app now uses: a <Modal> is its own native window, and on
 * Android that window does not get the provider's keyboard animation. Wrapping
 * the send modal in one was verified on an emulator (5 Sep 2026) and left the
 * modal squeezed into the top half of the screen with a dead black band below
 * it — the padding went on when the keyboard opened and never came off. Worse
 * than the bug it was meant to fix, and only visible on a device.
 *
 * React Native's own Keyboard events DO fire inside these modals on Android
 * (DocumentEmailPreviewModal has relied on them for months to hide its footer),
 * so they are the mechanism that actually works here. Apply the result as
 * paddingBottom on the modal's outer container and the content lifts clear.
 *
 * `keyboardWillShow` on iOS so the padding animates with the keyboard rather
 * than snapping after it; Android only has the Did events.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      const next = e?.endCoordinates?.height;
      setHeight(typeof next === 'number' && Number.isFinite(next) && next > 0 ? next : 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
