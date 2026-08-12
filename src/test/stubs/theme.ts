/**
 * Theme stub for component tests.
 *
 * The real barrel re-exports ./legacy, which imports react-native-paper, whose
 * dependency chain ships Flow-typed sources vite cannot parse. Any test that
 * renders a themed component mocks '../theme' with this.
 *
 * Every colour resolves to '#000000' — these tests assert behaviour, not
 * appearance. Colour correctness is covered by the contrast and palette-usage
 * guards in src/theme/, which read the real values.
 *
 * Usage:
 *   vi.mock('../theme', async () => await import('../test/stubs/theme'));
 */

const anyColor = new Proxy({}, { get: () => '#000000' }) as Record<string, string>;
const anyNumber = new Proxy({}, { get: () => 8 }) as Record<string, number>;
const anyStyle = new Proxy({}, { get: () => ({}) }) as Record<string, object>;

const fakeTheme = {
  name: 'dark' as const,
  colors: anyColor,
  space: anyNumber,
  radius: anyNumber,
  type: anyStyle,
  elevation: anyStyle,
};

export const colors = anyColor;
export const theme = { colors: anyColor, roundness: 12 };
export const schemes = { light: anyColor, dark: anyColor };
export const space = anyNumber;
export const radius = anyNumber;
export const typeScale = anyStyle;
export const LIGHT_MODE_ENABLED = false;

export const buildTheme = () => fakeTheme;
export const useThemeColors = () => anyColor;
export const useAppTheme = () => ({
  theme: fakeTheme,
  scheme: 'dark' as const,
  preference: 'system' as const,
  setPreference: () => {},
  ready: true,
});

/**
 * Builds once at module scope, exactly like the real implementation, so a test
 * that asserts style identity across renders behaves the same way.
 */
export const makeStyles = (build: (t: typeof fakeTheme) => Record<string, object>) => {
  let cached: Record<string, object> | null = null;
  return () => {
    if (!cached) cached = build(fakeTheme);
    return cached;
  };
};

export const ThemeProvider = ({ children }: { children: unknown }) => children;
