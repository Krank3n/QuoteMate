/**
 * Rollout flags for the theme migration.
 */

/**
 * Light mode is LIVE.
 *
 * Every screen now builds its styles through `makeStyles`, so both themes
 * render fully. The Appearance row is visible in Settings and `resolveScheme`
 * honours the user's choice.
 *
 * Kept as a flag rather than deleted: it is the one-line kill switch if light
 * mode turns out to have a problem in the field, and flipping it back clamps
 * the whole app to dark without touching a single screen.
 */
export const LIGHT_MODE_ENABLED = true;
