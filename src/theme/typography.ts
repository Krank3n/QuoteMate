/**
 * Type scale — nine tokens replacing roughly twenty ad-hoc font sizes.
 *
 * The rule: Archivo for the interface, system fonts for body copy.
 *
 * CRITICAL — React Native does not synthesise weights for custom fonts. On
 * Android `fontWeight` is ignored entirely when `fontFamily` is set, so a style
 * with both renders as Regular with NO error and NO warning. Every Archivo
 * token therefore names an exact face and omits `fontWeight`; every system
 * token sets `fontWeight` and omits `fontFamily`. theme.parity.test.ts asserts
 * no token ever carries both.
 */

import { TextStyle } from 'react-native';

import ArchivoMedium from '../../assets/fonts/Archivo-Medium.ttf';
import ArchivoSemiBold from '../../assets/fonts/Archivo-SemiBold.ttf';
import ArchivoBold from '../../assets/fonts/Archivo-Bold.ttf';
import ArchivoExtraBold from '../../assets/fonts/Archivo-ExtraBold.ttf';

/**
 * Keys must match the useFonts() map in App.tsx exactly — a typo here loads
 * nothing and silently falls back to the system font.
 */
export const fontFamily = {
  medium: 'Archivo-Medium',
  semibold: 'Archivo-SemiBold',
  bold: 'Archivo-Bold',
  extrabold: 'Archivo-ExtraBold',
} as const;

/**
 * Every font file the app must load, keyed by the family name styles use.
 *
 * ESM imports rather than require(): Metro handles both, but require() is left
 * untransformed by vite and breaks every test that touches this module.
 */
export const FONT_ASSETS = {
  'Archivo-Medium': ArchivoMedium,
  'Archivo-SemiBold': ArchivoSemiBold,
  'Archivo-Bold': ArchivoBold,
  'Archivo-ExtraBold': ArchivoExtraBold,
} as const;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Named `typeScale`, not `type` — `export { type } from './typography'` is
 * ambiguous with TypeScript's type-only export syntax and would not compile.
 * It is still exposed as `theme.type` on the theme object, so call sites read
 * `t.type.figureXL`.
 */
export const typeScale = {
  // ---- Figures. Archivo ExtraBold + tabular numerals. -------------------
  // Kept separate from title/heading even though they share a face: they
  // carry tabular-nums and their own tracking, and being distinct tokens is
  // what lets the money-vs-chrome colour split be applied by token rather
  // than by judgement.
  figureXL: {
    fontFamily: fontFamily.extrabold,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.96,
    ...tabular,
  } as TextStyle,
  figureL: {
    fontFamily: fontFamily.extrabold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.72,
    ...tabular,
  } as TextStyle,
  figureM: {
    fontFamily: fontFamily.extrabold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.34,
    ...tabular,
  } as TextStyle,

  // ---- Interface. Archivo. ---------------------------------------------
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.48,
  } as TextStyle,
  heading: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
  } as TextStyle,
  subheading: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.17,
  } as TextStyle,
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: 13,
    lineHeight: 18,
  } as TextStyle,
  overline: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
  } as TextStyle,

  // ---- Body copy. System font — native rendering where reading volume is
  // highest, and a graceful fallback if Archivo ever fails to load. --------
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' } as TextStyle,
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' } as TextStyle,
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' } as TextStyle,
} as const;

export type TypeToken = keyof typeof typeScale;

/** Tokens that must resolve to Archivo. Used by the parity test. */
export const ARCHIVO_TOKENS: readonly TypeToken[] = [
  'figureXL',
  'figureL',
  'figureM',
  'title',
  'heading',
  'subheading',
  'label',
  'overline',
];

/** Tokens that must stay on the system font. */
export const SYSTEM_TOKENS: readonly TypeToken[] = ['body', 'bodyStrong', 'caption'];
