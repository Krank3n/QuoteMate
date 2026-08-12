/**
 * Theme-reactive stylesheets.
 *
 * The problem this solves: ~120 module-scope `StyleSheet.create({...})` blocks
 * across 122 files bake `colors.*` in at import time, so nothing can react to a
 * theme change. Converting them all to build styles inside the render body
 * would work but would rebuild every stylesheet on every render.
 *
 * Instead the factory lives at module scope and caches per scheme, so
 * `StyleSheet.create` runs AT MOST TWICE per file for the life of the process —
 * once for light, once for dark — and costs nothing per render.
 *
 *   const useStyles = makeStyles((t) => ({
 *     card: { backgroundColor: t.colors.surfaceRaised, borderRadius: t.radius.lg },
 *   }));
 *
 *   function JobCard() {
 *     const styles = useStyles();   // one line at the call site
 *     ...
 *   }
 */

import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { useAppTheme } from './ThemeProvider';
import type { Theme } from './build';
import type { SchemeName } from './semantic';

/**
 * Mirrors React Native's own StyleSheet.create signature. Anything looser —
 * `{ [P in keyof T]: object }`, say — widens string literals, so
 * `alignItems: 'center'` infers as `string` and every style fails to assign
 * to ViewStyle at the call site.
 */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

export function makeStyles<T extends NamedStyles<T> | NamedStyles<any>>(
  build: (theme: Theme) => T & NamedStyles<any>,
): () => T {
  // Module scope: survives every render and every unmount.
  const cache = new Map<SchemeName, T>();

  return function useStyles(): T {
    const { theme } = useAppTheme();
    let styles = cache.get(theme.name);
    if (!styles) {
      styles = StyleSheet.create(build(theme)) as T;
      cache.set(theme.name, styles);
    }
    return styles;
  };
}

/**
 * For the handful of places that need theme-derived values OUTSIDE a React
 * render — navigation `screenOptions`, the Paper theme object, StatusBar. These
 * take the theme explicitly because there is no hook available at the call site.
 */
export function styleSheetFor<T extends NamedStyles<T> | NamedStyles<any>>(
  theme: Theme,
  build: (theme: Theme) => T & NamedStyles<any>,
): T {
  return StyleSheet.create(build(theme)) as T;
}
