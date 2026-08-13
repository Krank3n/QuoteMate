/**
 * Theme context.
 *
 * Co-located in src/theme/ rather than a new src/contexts/ directory: the
 * provider, the tokens and makeStyles are one unit, and splitting them across
 * directories would create an import cycle through the barrel.
 *
 * Resolution order:
 *   preference 'light' | 'dark'  → that scheme
 *   preference 'system'          → the OS scheme
 *   unset (never chosen)         → 'dark', the app's default look
 *   LIGHT_MODE_ENABLED === false → clamped to 'dark' regardless (Stage 1)
 *
 * Dark is the default rather than 'system' because QuoteMate has always looked
 * dark, and a phone on auto-light would otherwise hand a first-time user a
 * different app to the one in every screenshot. 'system' stays available, it
 * just has to be chosen.
 *
 * The clamp is what makes this shippable before the screens have migrated: the
 * whole mechanism runs and is testable, but users only ever see dark.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import { buildTheme, type Theme } from './build';
import type { SchemeName } from './semantic';
import { LIGHT_MODE_ENABLED } from './config';
import {
  getAppearancePreference,
  setAppearancePreference,
  type AppearancePreference,
} from '../services/appearance';

/** What the app looks like before the user says otherwise. */
export const DEFAULT_APPEARANCE: AppearancePreference = 'dark';

interface ThemeContextValue {
  theme: Theme;
  scheme: SchemeName;
  /** What the user chose. DEFAULT_APPEARANCE when they never have. */
  preference: AppearancePreference;
  setPreference: (pref: AppearancePreference) => void;
  /** False until the stored preference has been read. */
  ready: boolean;
}

/**
 * Default is the dark theme, not undefined — a component rendered outside the
 * provider (a test, a Storybook-style harness, an error boundary above it)
 * should render the app's real look rather than crash.
 */
const ThemeContext = createContext<ThemeContextValue>({
  theme: buildTheme('dark'),
  scheme: 'dark',
  preference: DEFAULT_APPEARANCE,
  setPreference: () => {},
  ready: false,
});

export function resolveScheme(
  preference: AppearancePreference,
  systemScheme: SchemeName,
): SchemeName {
  if (!LIGHT_MODE_ENABLED) return 'dark';
  if (preference === 'system') return systemScheme;
  return preference;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<AppearancePreference>(DEFAULT_APPEARANCE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAppearancePreference()
      .then((stored) => {
        if (cancelled) return;
        if (stored) setPreferenceState(stored);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((pref: AppearancePreference) => {
    // Optimistic: apply immediately, persist in the background. A failed write
    // costs the choice on next launch, which beats a laggy toggle.
    setPreferenceState(pref);
    void setAppearancePreference(pref);
  }, []);

  const scheme = resolveScheme(preference, system === 'light' ? 'light' : 'dark');

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: buildTheme(scheme), scheme, preference, setPreference, ready }),
    [scheme, preference, setPreference, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Just the tokens — the common case in a component. */
export function useThemeColors() {
  return useContext(ThemeContext).theme.colors;
}
