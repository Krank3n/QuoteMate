/**
 * Appearance preference storage.
 *
 * Tri-state: 'system' follows the phone, 'light'/'dark' pin it. Nothing stored
 * means the user has never chosen, which the provider renders as dark — see
 * DEFAULT_APPEARANCE in src/theme/ThemeProvider.tsx.
 *
 * Stored locally rather than in Firestore — it is a per-device choice (a tradie
 * may want dark on the phone in the ute and light on the tablet), and it must
 * be readable before auth resolves so the first paint isn't the wrong theme.
 *
 * Same fire-and-forget posture as pendingReferral: a storage failure must never
 * block launch. Every read falls back to null, which the provider treats as
 * "not chosen yet".
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const APPEARANCE_KEY = '@quotemate:appearance';

export type AppearancePreference = 'system' | 'light' | 'dark';

const VALID: readonly string[] = ['system', 'light', 'dark'];

export function isAppearancePreference(v: unknown): v is AppearancePreference {
  return typeof v === 'string' && VALID.includes(v);
}

/** Returns null when the user has never chosen — NOT a default. */
export async function getAppearancePreference(): Promise<AppearancePreference | null> {
  try {
    const stored = await AsyncStorage.getItem(APPEARANCE_KEY);
    return isAppearancePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function setAppearancePreference(pref: AppearancePreference): Promise<void> {
  if (!isAppearancePreference(pref)) return;
  try {
    await AsyncStorage.setItem(APPEARANCE_KEY, pref);
  } catch {
    // Non-fatal: the choice applies for this session and re-asks next launch.
  }
}

/**
 * Pin an upgrading user to dark, once.
 *
 * Every user before this release has only ever seen a dark app. With no stored
 * preference there is nothing to distinguish "upgraded" from "fresh install",
 * so the caller passes the signal App.tsx already branches on — signed in AND
 * onboarded means they were here before this shipped, and they keep the app
 * they know.
 *
 * Now that unset also resolves to dark this changes nothing on screen; it is
 * kept so a returning user's dark is a recorded choice rather than a default
 * that could move out from under them.
 *
 * Returns the preference now in force, or null if nothing was written.
 */
export async function seedAppearanceForExistingUser(
  isReturningUser: boolean,
): Promise<AppearancePreference | null> {
  if (!isReturningUser) return null;
  const existing = await getAppearancePreference();
  // Never overwrite a real choice — this only fills the gap left by upgrading.
  if (existing) return existing;
  await setAppearancePreference('dark');
  return 'dark';
}

/** Test-only helper; also used by localDataReset if appearance should be wiped. */
export async function clearAppearancePreference(): Promise<void> {
  try {
    await AsyncStorage.removeItem(APPEARANCE_KEY);
  } catch {
    // ignore
  }
}
