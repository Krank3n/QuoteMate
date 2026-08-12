/**
 * Semantic colour tokens — the vocabulary screens actually use.
 *
 * `light` and `dark` MUST expose an identical key set; theme.parity.test.ts
 * enforces it, so a token added to one theme can't silently be missing in the
 * other and render `undefined`.
 *
 * Two rules encoded here rather than left to judgement:
 *
 *   1. `accent` is chrome — buttons, links, active states. `money` is money —
 *      totals, revenue, paid/won. The old palette used one green for both,
 *      which is why totals drown in same-coloured chrome today.
 *   2. A draft means nothing has happened yet, so it is `neutral`, not
 *      `warning`. `warning` is reserved for genuinely overdue.
 *
 * Status roles: neutral draft · accent sent · money paid/won · warning overdue
 * · error failed.
 */

import { ink, slate, cream, orange, green, amber, red, blue } from './palette';

export interface Tokens {
  // Surfaces
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;

  /** Hover/overlay step above a card — menus, inline editors, chips on cards. */
  surfaceOverlay: string;
  /** Pressed state for a tappable surface. */
  surfacePressed: string;

  // Text
  text: string;
  /** Between `text` and `textMuted`. The legacy palette's `onSurface`. */
  textSecondary: string;
  textMuted: string;
  /** Placeholders and disabled controls. Not required to meet AA. */
  textDisabled: string;
  /**
   * Content over photos, lightboxes and scrims — surfaces that are dark in
   * BOTH themes, so this stays white either way. Distinct from `onAccent`,
   * which is near-black because it sits on orange.
   */
  alwaysLight: string;
  /** Decoration and disabled states ONLY. Sits at 2.60:1 on a raised card in
   *  dark mode, so it fails even the large-text threshold — never use it for
   *  text on a card. Use `textMuted`. */
  textFaint: string;

  // Accent (chrome, actions)
  accent: string;
  onAccent: string;
  /**
   * Border for filled accent surfaces. WCAG 1.4.11 wants 3:1 for a UI
   * component's own shape, and the light fill only reaches 2.52:1 against the
   * canvas — where the dashboard's primary CTA actually sits. Rather than
   * dulling the orange until it passes (which is what made the first light
   * palette muddy), the edge carries the requirement and the fill stays vivid.
   * In dark mode the fill already clears it at 6.89:1, so this matches the
   * fill and renders as no visible border.
   */
  accentBorder: string;
  accentText: string;
  accentSubtle: string;
  accentFaint: string;

  // Money
  money: string;
  moneySubtle: string;

  // Status
  neutral: string;
  neutralSubtle: string;
  warning: string;
  warningSubtle: string;
  error: string;
  errorSubtle: string;
  info: string;
  infoSubtle: string;

  // Overlays
  backdrop: string;
  overlayPressed: string;
}

export const dark: Tokens = {
  bg: slate[950],
  surface: slate[900],
  // NOT the marketing site's #11182a. On a hero with glows behind it that
  // reads fine; in a dense list it separates at only 1.093 — flatter than the
  // app today (1.220). This is 1.245.
  surfaceRaised: slate[800],
  surfaceSunken: '#080B12',
  surfaceOverlay: '#243049',
  surfacePressed: '#212C42',
  border: 'rgba(148, 163, 184, 0.15)',
  borderStrong: 'rgba(148, 163, 184, 0.24)',

  text: slate.ice,
  textSecondary: '#B7C0CE', // 8.46:1 on a card
  textMuted: slate[500],
  textFaint: slate[600],
  textDisabled: '#6B7688',
  alwaysLight: slate[0],

  accent: orange.fill,
  onAccent: ink,
  // Same as the fill: dark mode needs no edge, the fill is already 6.89:1.
  accentBorder: orange.fill,
  accentText: orange.textDark,
  accentSubtle: 'rgba(249, 115, 22, 0.15)',
  accentFaint: 'rgba(249, 115, 22, 0.08)',

  money: green.dark,
  moneySubtle: 'rgba(52, 211, 153, 0.14)',

  neutral: slate[400],
  neutralSubtle: 'rgba(148, 163, 184, 0.14)',
  warning: amber.dark,
  warningSubtle: 'rgba(230, 184, 114, 0.14)',
  error: red.dark,
  errorSubtle: 'rgba(248, 113, 113, 0.14)',
  info: blue.dark,
  infoSubtle: 'rgba(90, 185, 234, 0.14)',

  backdrop: 'rgba(0, 0, 0, 0.7)',
  overlayPressed: 'rgba(255, 255, 255, 0.06)',
};

export const light: Tokens = {
  // Cream, from the marketing site's hero variant B. A touch deeper than the
  // site's #F5F4EF so a white card still separates (1.215) rather than relying
  // on the grid alone.
  bg: cream.canvas,
  // Chrome (headers, tab bar) is cream-tinted, NOT white — the site's variant B
  // topbar is rgba(245,244,239,.9) for the same reason. A pure-white bar cuts a
  // hard band across the top of a cream page.
  surface: cream.chrome,
  // Cards stay white so they lift off the cream.
  surfaceRaised: cream.card,
  surfaceSunken: cream.sunken,
  surfaceOverlay: cream.overlay,
  surfacePressed: cream.pressed,
  border: cream.border,
  borderStrong: cream.borderStrong,

  // Warm near-black rather than the slate one — on a cream ground a cool grey
  // reads as a different temperature to everything around it.
  text: cream.ink,
  textSecondary: cream.inkSecondary,
  textMuted: cream.inkMuted,
  textFaint: cream.inkFaint,
  textDisabled: cream.inkDisabled,
  alwaysLight: slate[0],

  accent: orange.fillLight,
  onAccent: ink,
  accentBorder: orange.textLight,
  accentText: orange.textLight,
  accentSubtle: 'rgba(255, 138, 61, 0.18)',
  accentFaint: 'rgba(255, 138, 61, 0.10)',

  money: green.light,
  moneySubtle: 'rgba(3, 107, 76, 0.13)',

  neutral: cream.inkMuted,
  neutralSubtle: '#EFEDE6',
  warning: amber.light,
  warningSubtle: 'rgba(138, 97, 0, 0.14)',
  error: red.light,
  errorSubtle: 'rgba(200, 30, 30, 0.12)',
  info: blue.light,
  infoSubtle: 'rgba(3, 105, 161, 0.12)',

  backdrop: 'rgba(26, 24, 20, 0.45)',
  overlayPressed: 'rgba(26, 24, 20, 0.06)',
};

export type SchemeName = 'light' | 'dark';

export const schemes: Record<SchemeName, Tokens> = { light, dark };
