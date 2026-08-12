/**
 * Theme barrel.
 *
 * This replaces the old src/theme.ts file. Both cannot exist — Metro and
 * TypeScript resolve `src/theme.ts` ahead of `src/theme/index.ts`, so the file
 * was moved to ./legacy and is re-exported here. Every existing
 * `import { colors } from '../theme'` keeps resolving, unchanged, to the same
 * frozen dark values it always had.
 *
 * New code should use `makeStyles` + `useAppTheme` and the semantic tokens.
 */

// ---- The new system ------------------------------------------------------
export { schemes } from './semantic';
export type { Tokens, SchemeName } from './semantic';

export { space, radius } from './scales';
export type { SpaceToken, RadiusToken } from './scales';

export {
  typeScale,
  fontFamily,
  FONT_ASSETS,
  ARCHIVO_TOKENS,
  SYSTEM_TOKENS,
} from './typography';
export type { TypeToken } from './typography';

export { elevationFor, buildElevation } from './elevation';
export type { ElevationLevel } from './elevation';

export { buildTheme } from './build';
export type { Theme } from './build';

export { ThemeProvider, useAppTheme, useThemeColors, resolveScheme } from './ThemeProvider';
export { makeStyles, styleSheetFor } from './makeStyles';

// NOT re-exported: ./adapters imports react-native-paper and
// @react-navigation/native, and anything the barrel imports is dragged into
// every test that touches a token. App.tsx imports it directly.

export { LIGHT_MODE_ENABLED } from './config';
