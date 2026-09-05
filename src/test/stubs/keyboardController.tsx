/**
 * Inert stand-in for react-native-keyboard-controller under vitest.
 *
 * The real package ships untranspiled syntax vite chokes on ("Unexpected token
 * 'typeof'"), and it is imported statically by AuthScreen, the send modal and
 * every other screen that has to get out of the keyboard's way — so one import
 * takes down the whole suite, not just a test that cares about the keyboard.
 *
 * Every export here renders its children in a plain View and nothing else.
 * There is no keyboard under jsdom, so keyboard avoidance is a no-op by
 * definition; what the tests assert is the content inside these wrappers.
 * Whether the avoidance itself is wired correctly is a static question, and
 * components/keyboardAvoidance.guard.test.ts answers it.
 *
 * Only the five names the app actually imports are here. Adding an import of
 * some other export later fails as an ESM "no such export" rather than
 * degrading quietly, which is the right way round.
 */

import React from 'react';
import { View, ScrollView, type ViewProps, type ScrollViewProps } from 'react-native';

type Wrapper = ViewProps & {
  behavior?: string;
  keyboardVerticalOffset?: number;
  offset?: { closed?: number; opened?: number };
};

/** Drop the keyboard-only props so React Native Web doesn't see unknown ones. */
const passthrough = (displayName: string) => {
  const Component = ({
    children,
    behavior: _behavior,
    keyboardVerticalOffset: _verticalOffset,
    offset: _offset,
    ...rest
  }: Wrapper) => <View {...rest}>{children}</View>;
  Component.displayName = displayName;
  return Component;
};

export const KeyboardAvoidingView = passthrough('KeyboardAvoidingView');
export const KeyboardProvider = passthrough('KeyboardProvider');
export const KeyboardStickyView = passthrough('KeyboardStickyView');
export const KeyboardToolbar = passthrough('KeyboardToolbar');

export const KeyboardAwareScrollView = ({ children, ...rest }: ScrollViewProps) => (
  <ScrollView {...rest}>{children}</ScrollView>
);
KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

