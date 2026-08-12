/**
 * Adapters that hand our tokens to the two libraries that keep their own theme
 * objects: react-native-paper and react-navigation.
 *
 * Both are fed from the SAME token set as everything else, so a theme switch
 * moves the app chrome and the component library together. Previously each had
 * a hand-written dark object that could drift from the palette.
 */

import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { DarkTheme as NavDark, DefaultTheme as NavLight } from '@react-navigation/native';

import type { Theme } from './build';
import { radius } from './scales';

export function buildPaperTheme(theme: Theme) {
  const base = theme.name === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const c = theme.colors;
  return {
    ...base,
    colors: {
      ...base.colors,
      // Paper uses `primary` for TWO different things: the container of a
      // contained Button, and the LABEL of a text/outlined one. There are 178
      // text/outlined buttons against 50 contained, and a label needs to be
      // legible on a surface — so `primary` is the foreground colour, and
      // contained buttons are given the vivid fill explicitly via FooterButton
      // and `buttonColor`.
      primary: c.accentText,
      onPrimary: c.alwaysLight,
      secondary: c.warning,
      onSecondary: c.onAccent,
      // NOT `bg`. Paper overloads `background` the same way it overloads
      // `primary`: it is the fill of an outlined TextInput (and the label notch
      // that punches through the outline), not the app canvas. Pointing it at
      // the canvas fills every outlined input with the cream ground, so on a
      // white card the inputs read as dark grey-beige blocks, and on the canvas
      // itself they vanish into it. The card colour is right on both grounds —
      // it pops against the canvas, and on a card the outline does the work.
      // Symmetric in dark, where inputs were rendering near-black on a lighter
      // card for exactly the same reason.
      background: c.surfaceRaised,
      surface: c.surfaceRaised,
      onSurface: c.text,
      onSurfaceVariant: c.textMuted,
      surfaceVariant: c.surfaceOverlay,
      outline: c.borderStrong,
      outlineVariant: c.border,
      error: c.error,
      onError: c.onAccent,
      backdrop: c.backdrop,
    },
    roundness: radius.md,
  };
}

export function buildNavigationTheme(theme: Theme) {
  const base = theme.name === 'dark' ? NavDark : NavLight;
  const c = theme.colors;
  return {
    ...base,
    dark: theme.name === 'dark',
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.bg,
      // Header and tab-bar ground: the flat chrome surface, NOT the card
      // colour. An accent-coloured header bar carrying a light label measured
      // 2.40:1.
      card: c.surface,
      text: c.text,
      border: c.border,
      notification: c.accent,
    },
  };
}

/** expo-status-bar wants light/dark ICONS, which is the inverse of the theme. */
export function statusBarStyle(theme: Theme): 'light' | 'dark' {
  return theme.name === 'dark' ? 'light' : 'dark';
}
