/**
 * Canonical app-store identifiers and URLs.
 *
 * These were previously hard-coded in each place that needed them and had
 * DRIFTED to three different Apple app IDs across the app and the marketing
 * site (6740091464, 6738030590, 6754000046). Only 6754000046 resolves — the
 * others 404, so the in-app "update available" prompt sent iOS users to a dead
 * App Store page, and one referral landing page did the same.
 *
 * Verify with:
 *   curl -s "https://itunes.apple.com/lookup?id=6754000046&country=au"
 * => trackName "QuoteMate: Quotes & Invoices", bundleId com.hansendev.quotemate
 *
 * Keep in sync with app.config.js (ios.bundleIdentifier / android.package) —
 * guarded by storeLinks.test.ts.
 */

/** Apple App Store numeric app ID (the live listing). */
export const APPLE_APP_ID = '6754000046';

/** iOS bundle identifier — mirrors app.config.js ios.bundleIdentifier. */
export const IOS_BUNDLE_ID = 'com.hansendev.quotemate';

/** Android application id — mirrors app.config.js android.package. */
export const ANDROID_PACKAGE = 'com.quotemate.app';

export const APP_STORE_URL = `https://apps.apple.com/au/app/quotemate/id${APPLE_APP_ID}`;
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/**
 * Deep link to the user's own subscription management screen.
 * Apple requires a route to manage/cancel an auto-renewing subscription
 * (Guideline 3.1.2) — never a custom cancellation flow.
 */
export const APPLE_MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
export const PLAY_MANAGE_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';

export function storeUrlForPlatform(platform: string): string {
  if (platform === 'ios') return APP_STORE_URL;
  if (platform === 'android') return PLAY_STORE_URL;
  return 'https://quotemateapp.au';
}
