/**
 * The stack header's back chevron, drawn by the app.
 *
 * @react-navigation/stack draws its default back control from a PNG bundled
 * in @react-navigation/elements (back-icon.png + back-icon-mask.png). On iPad
 * that image never appears: the Job screen showed nothing on the left of its
 * header (though the accessibility tree still held a "Main, back" button),
 * and the NewQuote stack showed the bare word "Main" with no chevron. iPhone
 * was fine. Rather than depend on that asset, every stack navigator in
 * RootNavigator passes this as `headerBackImage`, so the chevron comes from
 * the same icon font the rest of the app draws with — on iPhone, iPad, Android
 * and web alike.
 *
 * The header calls `headerBackImage({ tintColor })` with the stack's
 * `headerTintColor` (themeColors.text on every stack here); when it isn't
 * passed we fall back to the theme's text colour ourselves. Layout — hit-slop,
 * press feedback, the accessibility label — stays with the library's
 * HeaderBackButton; this only supplies the glyph.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useThemeColors } from '../theme';

export const HEADER_BACK_CHEVRON_ICON = 'chevron-left' as const;

/** Sized to sit level with the bold header title. */
export const HEADER_BACK_CHEVRON_SIZE = 30;

export interface HeaderBackChevronProps {
  /** The stack's headerTintColor, as passed by the library's HeaderBackButton. */
  tintColor?: string;
}

export function HeaderBackChevron({ tintColor }: HeaderBackChevronProps) {
  const themeColors = useThemeColors();
  return (
    <MaterialCommunityIcons
      name={HEADER_BACK_CHEVRON_ICON}
      size={HEADER_BACK_CHEVRON_SIZE}
      color={tintColor ?? themeColors.text}
      // The library's iOS back button has no horizontal padding of its own
      // (its bundled image carried the spacing); give the glyph the same
      // breathing room from the screen edge the Android/web button gets.
      style={Platform.OS === 'ios' ? styles.ios : undefined}
      testID="header-back-chevron"
    />
  );
}

const styles = StyleSheet.create({
  ios: { marginStart: 8 },
});

/** Drop-in value for a stack navigator's `headerBackImage` screen option. */
export function renderHeaderBackChevron(props: HeaderBackChevronProps) {
  return <HeaderBackChevron {...props} />;
}
