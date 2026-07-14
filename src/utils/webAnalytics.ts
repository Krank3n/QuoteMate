/**
 * Google Analytics for the WEB build only (quotemateapp.au/app).
 *
 * The web app is served from the same origin as the marketing site, so using
 * the same GA4 property (G-E3JERN2D5V) shares the _ga client id — a sign_up
 * fired here attributes back to whatever channel/page brought the visitor to
 * the site. Everything in this module is a hard no-op on iOS/Android.
 *
 * Respects the owner opt-out used by the marketing site: if
 * localStorage.qm_notrack === '1' (set by visiting any page with ?notrack=1),
 * GA never loads.
 */
import { Platform } from 'react-native';

const GA_ID = 'G-E3JERN2D5V';

function isWeb(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function initWebAnalytics(): void {
  if (!isWeb()) return;
  try {
    if (window.localStorage.getItem('qm_notrack') === '1') return;
  } catch {
    // localStorage unavailable (privacy mode) — proceed; GA handles it
  }
  const w = window as any;
  if (typeof w.gtag === 'function') return; // already initialised
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  };
  w.gtag('js', new Date());
  w.gtag('config', GA_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

/** Fire a GA event. Safe to call anywhere — no-op on native or when GA is off. */
export function trackWebEvent(name: string, params?: Record<string, unknown>): void {
  if (!isWeb()) return;
  const w = window as any;
  if (typeof w.gtag !== 'function') return;
  w.gtag('event', name, params || {});
}
