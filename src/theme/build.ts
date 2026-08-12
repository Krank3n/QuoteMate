/**
 * Assembles the full theme object for a scheme.
 *
 * Memoised per scheme: there are exactly two possible themes for the life of
 * the process, so they are built at most once each and every consumer shares
 * the same object identity. That identity matters — makeStyles caches on it,
 * and a fresh object each render would defeat the cache.
 */

import { schemes, type SchemeName, type Tokens } from './semantic';
import { space, radius } from './scales';
import { typeScale } from './typography';
import { buildElevation, type ElevationLevel } from './elevation';
import type { ViewStyle } from 'react-native';

export interface Theme {
  name: SchemeName;
  colors: Tokens;
  space: typeof space;
  radius: typeof radius;
  type: typeof typeScale;
  elevation: Record<ElevationLevel, ViewStyle>;
}

const cache = new Map<SchemeName, Theme>();

export function buildTheme(name: SchemeName): Theme {
  const hit = cache.get(name);
  if (hit) return hit;

  const colors = schemes[name];
  const built: Theme = {
    name,
    colors,
    space,
    radius,
    type: typeScale,
    elevation: buildElevation(name, colors),
  };
  cache.set(name, built);
  return built;
}

/** Test-only. Never call from app code — consumers rely on stable identity. */
export function __resetThemeCache() {
  cache.clear();
}
