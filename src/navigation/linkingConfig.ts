/**
 * Deep-link route map (shared by App.tsx's LinkingOptions and its tests).
 *
 * Extracted from App.tsx so the URL contract can be unit tested — a broken
 * entry here is invisible in TypeScript and only shows up as a dead QR code or
 * a 404 on web refresh.
 *
 * Native path allow-lists that must stay in sync:
 *   - iOS:     public/.well-known/apple-app-site-association  (`paths`)
 *   - Android: app.config.js android.intentFilters[0].data     (`pathPrefix`)
 * A route added here without the matching native entry silently keeps opening
 * the website instead of the app.
 */
export const LINKING_SCREENS = {
  DiscoverSuppliers: 'join',
  // Referral QR codes / shared links: https://quotemateapp.au/ref/QM-AB2CD3
  //
  // `code` MUST stay optional. With a required `:code`, navigating to this
  // screen from Settings (no params) serialises to the literal path
  // `/app/ref/undefined`, which 404s on a hard refresh of the web build.
  Referral: 'ref/:code?',
} as const;

/**
 * Full linking config for NavigationContainer.
 *
 * `initialRouteName` matters on native: a cold open on a deep link (a scanned
 * referral QR, a supplier /join link, a notification) would otherwise build a
 * navigation state holding only that screen, so the first back press has
 * nothing to pop to and leaves the app. Seeding Main beneath it makes back
 * land on the Dashboard instead. On web it means a refresh on /app/ref/… still
 * has the app behind the browser's back button.
 */
export const LINKING_CONFIG = {
  initialRouteName: 'Main',
  screens: { ...LINKING_SCREENS },
};
