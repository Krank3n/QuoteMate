/**
 * Structural guarantees about the token sets.
 *
 * The parity check is what stops a token being added to one theme and not the
 * other — the failure mode there is a style resolving to `undefined`, which
 * React Native renders as transparent rather than throwing, so it ships.
 *
 * The typography checks encode a React Native trap: on Android, `fontWeight`
 * is IGNORED when `fontFamily` is set on a custom font. A style with both
 * renders as Regular with no error and no warning. These assertions turn that
 * silent wrong-weight into a build failure.
 */

import { describe, it, expect } from 'vitest';

import { light, dark, schemes, type Tokens } from './semantic';
import {
  typeScale,
  fontFamily,
  FONT_ASSETS,
  ARCHIVO_TOKENS,
  SYSTEM_TOKENS,
  type TypeToken,
} from './typography';
import { buildTheme } from './build';

describe('token parity', () => {
  it('exposes an identical key set in both themes', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it.each(['light', 'dark'] as const)('%s has no empty or undefined values', (name) => {
    for (const [key, value] of Object.entries(schemes[name] as Tokens)) {
      expect(value, `${name}.${key}`).toBeTruthy();
      expect(typeof value, `${name}.${key}`).toBe('string');
    }
  });

  it.each(['light', 'dark'] as const)('%s uses no hex-alpha string concatenation', (name) => {
    // The old palette relied on `colors.primary + '15'`, which breaks the
    // moment a token becomes rgba(). Subtle variants are their own tokens now.
    for (const [key, value] of Object.entries(schemes[name] as Tokens)) {
      expect(value, `${name}.${key} looks like a concatenated 8-digit hex`).not.toMatch(
        /^#[0-9a-f]{8}$/i,
      );
    }
  });

  it.each(['light', 'dark'] as const)('%s parses as real colours', (name) => {
    for (const [key, value] of Object.entries(schemes[name] as Tokens)) {
      expect(value, `${name}.${key} = ${value}`).toMatch(
        /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\([\d.,\s]+\))$/i,
      );
    }
  });
});

describe('typography', () => {
  it('covers every token in exactly one of the Archivo or system groups', () => {
    const all = Object.keys(typeScale).sort() as TypeToken[];
    const grouped = [...ARCHIVO_TOKENS, ...SYSTEM_TOKENS].sort();
    expect(grouped).toEqual(all);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it.each(ARCHIVO_TOKENS)(
    '%s names an Archivo face and does NOT set fontWeight (Android ignores it)',
    (token) => {
      const style = typeScale[token] as Record<string, unknown>;
      expect(style.fontFamily, `${token} must name a face`).toBeTruthy();
      expect(Object.values(fontFamily)).toContain(style.fontFamily);
      expect(
        style.fontWeight,
        `${token} sets BOTH fontFamily and fontWeight — renders Regular on Android`,
      ).toBeUndefined();
    },
  );

  it.each(SYSTEM_TOKENS)('%s stays on the system font', (token) => {
    const style = typeScale[token] as Record<string, unknown>;
    expect(style.fontFamily, `${token} should not name a face`).toBeUndefined();
    expect(style.fontWeight, `${token} needs an explicit weight`).toBeTruthy();
  });

  it('gives every figure token tabular numerals so columns of money align', () => {
    for (const token of ['figureXL', 'figureL', 'figureM'] as const) {
      expect(typeScale[token].fontVariant, token).toContain('tabular-nums');
    }
  });

  it('registers a font asset for every family the scale references', () => {
    const referenced = new Set(
      ARCHIVO_TOKENS.map((t) => (typeScale[t] as Record<string, unknown>).fontFamily as string),
    );
    for (const family of referenced) {
      expect(Object.keys(FONT_ASSETS), `${family} is used but never loaded`).toContain(family);
    }
  });
});

describe('buildTheme', () => {
  it('returns a stable object per scheme so makeStyles can cache on it', () => {
    expect(buildTheme('dark')).toBe(buildTheme('dark'));
    expect(buildTheme('light')).toBe(buildTheme('light'));
    expect(buildTheme('dark')).not.toBe(buildTheme('light'));
  });

  it('carries the matching token set', () => {
    expect(buildTheme('light').colors).toBe(light);
    expect(buildTheme('dark').colors).toBe(dark);
  });

  it('expresses elevation differently per theme', () => {
    // Dark lifts with surface colour, light lifts with a shadow. If these ever
    // match, one of the themes has lost its depth cue.
    const darkCard = buildTheme('dark').elevation[2];
    const lightCard = buildTheme('light').elevation[2];
    expect(darkCard.shadowOpacity).toBe(0);
    expect(lightCard.shadowOpacity).toBeGreaterThan(0);
  });
});
