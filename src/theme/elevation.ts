/**
 * Elevation, which has to work two different ways.
 *
 * Dark mode conveys lift with a LIGHTER SURFACE — a drop shadow against
 * #0A0E16 is invisible, and Android's native `elevation` prop produces no
 * useful lift on a dark ground either. Light mode conveys it with a REAL
 * SHADOW, because every surface is already white.
 *
 * Both keep a hairline border, which is what carries the card edge outdoors
 * where soft shadows wash out in glare.
 *
 * These return shadow/border props only — the caller sets `backgroundColor`
 * from the surface tokens, so a card can be raised without guessing its fill.
 */

import { Platform, ViewStyle } from 'react-native';
import type { SchemeName, Tokens } from './semantic';

export type ElevationLevel = 0 | 1 | 2 | 3;

const NO_SHADOW: ViewStyle = {
  shadowColor: 'transparent',
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
};

function lightShadow(y: number, blur: number, opacity: number): ViewStyle {
  return {
    shadowColor: '#0F1421',
    shadowOffset: { width: 0, height: y },
    shadowOpacity: opacity,
    shadowRadius: blur,
    // Android ignores shadowColor/Opacity and uses this instead.
    elevation: Platform.OS === 'android' ? y + 1 : 0,
  };
}

/**
 * @param level 0 flush · 1 cards · 2 sheets and menus · 3 modals
 */
export function elevationFor(scheme: SchemeName, tokens: Tokens, level: ElevationLevel): ViewStyle {
  const hairline: ViewStyle = { borderWidth: 1, borderColor: tokens.border };

  if (scheme === 'dark') {
    // Lift is expressed purely as surface colour + border. Flat by design —
    // the trade-pro direction asks for flat surfaces, and shadows on a
    // near-black ground are wasted pixels.
    return { ...NO_SHADOW, ...(level === 0 ? {} : hairline) };
  }

  switch (level) {
    case 0:
      return { ...NO_SHADOW, ...hairline };
    case 1:
      return { ...lightShadow(1, 3, 0.06), ...hairline };
    case 2:
      return { ...lightShadow(4, 12, 0.09), ...hairline };
    case 3:
      return { ...lightShadow(10, 26, 0.12), ...hairline };
  }
}

/** Pre-built 0–3 for a scheme, so makeStyles callers index instead of calling. */
export function buildElevation(scheme: SchemeName, tokens: Tokens): Record<ElevationLevel, ViewStyle> {
  return {
    0: elevationFor(scheme, tokens, 0),
    1: elevationFor(scheme, tokens, 1),
    2: elevationFor(scheme, tokens, 2),
    3: elevationFor(scheme, tokens, 3),
  };
}
