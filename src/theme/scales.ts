/**
 * Spacing and radius scales.
 *
 * The app currently uses ~15 distinct border radii and freeform padding values
 * (2, 4, 6, 10, 14 all appear alongside 8/12/16). These replace them, so
 * surfaces stop looking almost-but-not-quite aligned.
 *
 * Combined into one file rather than spacing.ts + radius.ts — each would be a
 * dozen lines, and they are always imported together.
 */

/** 4-point grid. `space[3]` is the default card padding. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;

export const radius = {
  /** Chips' inner elements, small squares */
  xs: 6,
  /** Icon tiles, inputs */
  sm: 8,
  /** Buttons, controls */
  md: 12,
  /** Cards, sheets */
  lg: 16,
  /** Bottom sheets, modals */
  xl: 20,
  /** Fully rounded — status chips, tab pills */
  pill: 999,
} as const;

export type SpaceToken = keyof typeof space;
export type RadiusToken = keyof typeof radius;
