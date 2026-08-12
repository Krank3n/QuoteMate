/**
 * Raw colour values. Nothing outside src/theme/ should import this — screens
 * and components use the semantic tokens in ./semantic, so a value can be
 * retuned in one place without hunting for every call site.
 *
 * Every pair that carries text was verified against WCAG 2.1 AA before landing;
 * theme.contrast.test.ts keeps it that way. Two results drove the whole design:
 *
 *   - White on orange is 2.80:1 and FAILS. Orange fills take a near-black
 *     label (`ink`), which is also why they read like high-vis site signage.
 *   - Orange as *text* on white is 2.80:1 and FAILS. Light mode needs a
 *     separate, deeper `accentText`.
 *
 * Hence three accent tokens rather than one: a fill, a label-on-fill, and a
 * text-on-surface.
 */

/** Near-black. Label colour on every orange fill, in both themes. */
export const ink = '#0A0E16';

/**
 * Warm neutrals for light mode — taken from the marketing site's hero variant B
 * (`html[data-home-variant="b"]`), which runs a cream page with white panels.
 *
 * The site's own canvas is #F5F4EF, but a white card separates from that at only
 * 1.101 and floats. On the web that is masked by the grid texture the hero draws
 * over it; here the canvas is a touch deeper so the card reads on its own AND
 * carries the grid.
 */
export const cream = {
  canvas: '#ECE9DE', // 1.215 vs a white card
  card: '#FFFFFF',
  /** Headers and tab bar — warmer than a card, lighter than the canvas. */
  chrome: '#F6F4ED',
  sunken: '#F5F3EC',
  overlay: '#F7F5EF',
  pressed: '#E2DED0',
  border: '#DCD7C8',
  borderStrong: '#C6C0AE',
  ink: '#1A1814', // 14.58 on canvas
  inkSecondary: '#3A362F', // 9.88
  inkMuted: '#5F5B54', // 5.55
  inkFaint: '#9A958C', // decoration only
  inkDisabled: '#A9A398',
  /** 1px lines at ~3.5% black on 40px cells — the variant B grid. */
  grid: 'rgba(0, 0, 0, 0.035)',
  gridCell: 40,
} as const;

export const slate = {
  950: '#0A0E16',
  900: '#0F1421',
  800: '#1A2438',
  700: '#2A3550',
  500: '#8A93A3',
  400: '#98A2B3',
  600: '#5B6473',
  650: '#545D6D',
  450: '#7A8494',
  200: '#D6DBE4',
  250: '#BFC7D3',
  100: '#EAECF0',
  150: '#E6E9EF',
  50: '#F7F8FA',
  0: '#FFFFFF',
  ice: '#E8ECF2',
} as const;

export const orange = {
  /** Dark-mode fill. 6.89:1 against `ink`. */
  fill: '#F97316',
  /**
   * Light-mode fill. Deliberately BRIGHTER than the dark-mode fill.
   *
   * The button's shape requirement (WCAG 1.4.11, 3:1) is carried by
   * `accentBorder` (#B23C08, 4.87:1 against the canvas), which frees the fill
   * to be vivid. Lightening it then *improves* the label: near-black reads at
   * 8.24:1 here versus 6.29:1 on the old #F26A0A.
   *
   * The alternative — white labels — needs the fill darkened to #C2410C so
   * white clears 4.5:1, and that is the brown-orange that made the first light
   * palette look muddy. Brighter fill + dark label wins on both counts.
   */
  fillLight: '#FF8A3D',
  /** Accent text on dark surfaces. 6.86:1 on surfaceRaised. */
  textDark: '#FB923C',
  /** Accent text on light surfaces. 5.93 on card / 4.87 on canvas — #C2410C
   *  passes on a card but only reaches 4.26 on the canvas, where "View all"
   *  and section links actually sit. */
  textLight: '#B23C08',
} as const;

export const green = {
  /** Money on dark. 8.07:1 on surfaceRaised. */
  dark: '#34D399',
  /** Money on light. Deepened from #047857 for headroom on the cream canvas,
   *  which is darker than the old slate one: 6.54 card / 5.38 canvas. */
  light: '#036B4C',
} as const;

export const amber = {
  /** Overdue only — never "draft". */
  dark: '#E6B872',
  /** #B45309 was rejected: an orange-brown at almost exactly the accent's
   *  luminance, so a chip and a CTA read as the same colour. */
  light: '#8A6100',
} as const;

export const red = { dark: '#F87171', light: '#C81E1E' } as const;
export const blue = { dark: '#5AB9EA', light: '#0369A1' } as const;
