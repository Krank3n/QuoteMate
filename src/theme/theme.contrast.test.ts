/**
 * The outdoor-readability constraint, encoded.
 *
 * This app gets used on a phone in direct sun, so contrast is a requirement
 * rather than a preference. Every text token is checked against BOTH the
 * raised card AND the canvas, because coloured text appears on both — several
 * candidate values passed on a card and failed on the canvas, which is exactly
 * how the palette nearly shipped with an unreadable "View all" link.
 *
 * The banned-pairs block is the important half: it pins the specific mistakes
 * that were made and rejected during design, so they cannot creep back.
 */

import { describe, it, expect } from 'vitest';

import { light, dark, type Tokens, type SchemeName } from './semantic';
import {
  contrast,
  flatten,
  AA_TEXT,
  AA_LARGE,
  AA_NON_TEXT,
  SURFACE_SEPARATION,
} from './contrast';

const SCHEMES: Array<[SchemeName, Tokens]> = [
  ['light', light],
  ['dark', dark],
];

/** Text tokens that must clear AA on any surface they can land on. */
const TEXT_TOKENS = ['text', 'textMuted', 'accentText', 'money', 'warning', 'error', 'info'] as const;

/** The two grounds text actually sits on. */
const GROUNDS = ['bg', 'surfaceRaised'] as const;

describe.each(SCHEMES)('%s theme contrast', (name, t) => {
  it.each(TEXT_TOKENS)('%s clears AA on both the canvas and a raised card', (token) => {
    for (const ground of GROUNDS) {
      const ratio = contrast(t[token], t[ground]);
      expect(
        ratio,
        `${name}.${token} (${t[token]}) on ${ground} (${t[ground]}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('puts a legible label on the accent fill', () => {
    const ratio = contrast(t.onAccent, t.accent);
    expect(ratio, `onAccent on accent = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('makes an accent button findable against both grounds (WCAG 1.4.11)', () => {
    // The fill OR its border must carry the 3:1 — a vivid fill with a defined
    // edge satisfies the rule as well as a dull fill does, and looks better.
    // Light mode needs this: #F26A0A is 3.07:1 on a white card but only
    // 2.52:1 on the canvas, which is where the dashboard's primary CTA sits.
    for (const ground of GROUNDS) {
      const fill = contrast(t.accent, t[ground]);
      const edge = contrast(t.accentBorder, t[ground]);
      expect(
        Math.max(fill, edge),
        `${name} accent on ${ground}: fill ${fill.toFixed(2)}:1, border ${edge.toFixed(2)}:1 — neither defines the button shape`,
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it('separates a raised card from the canvas without relying on the border', () => {
    const ratio = contrast(t.surfaceRaised, t.bg);
    expect(
      ratio,
      `surfaceRaised (${t.surfaceRaised}) on bg (${t.bg}) = ${ratio.toFixed(3)} — cards float`,
    ).toBeGreaterThanOrEqual(SURFACE_SEPARATION);
  });

  it('keeps status text legible on its own subtle fill', () => {
    const pairs: Array<[string, string, string]> = [
      ['money', t.money, t.moneySubtle],
      ['neutral', t.neutral, t.neutralSubtle],
      ['warning', t.warning, t.warningSubtle],
      ['error', t.error, t.errorSubtle],
      ['accentText', t.accentText, t.accentSubtle],
    ];
    for (const [label, fg, fill] of pairs) {
      // Subtle fills are translucent, so resolve what the chip actually sits
      // on before measuring — comparing against the rgba() value directly
      // would overstate the ratio.
      const chipGround = flatten(fill, t.surfaceRaised);
      const ratio = contrast(fg, chipGround);
      expect(ratio, `${name} ${label} chip = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });
});

describe('banned pairs — mistakes made during design, pinned so they cannot return', () => {
  it('rejects white on orange (the reason onAccent is near-black)', () => {
    expect(contrast('#FFFFFF', '#F97316')).toBeLessThan(AA_TEXT);
    expect(contrast('#FFFFFF', '#F26A0A')).toBeLessThan(AA_TEXT);
  });

  it('rejects the bright orange as text on white', () => {
    expect(contrast('#F97316', '#FFFFFF')).toBeLessThan(AA_TEXT);
  });

  it('rejects #C2410C accent text on the light canvas — passes on a card, fails here', () => {
    expect(contrast('#C2410C', '#FFFFFF')).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast('#C2410C', light.bg)).toBeLessThan(AA_TEXT);
    // ...which is why the shipped value is deeper.
    expect(contrast(light.accentText, light.bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('rejects the vivid #00875A money green on the light canvas', () => {
    expect(contrast('#00875A', '#FFFFFF')).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast('#00875A', light.bg)).toBeLessThan(AA_TEXT);
  });

  it('rejects the marketing-site card colour, which does not separate in a list', () => {
    expect(contrast('#11182a', '#0A0E16')).toBeLessThan(SURFACE_SEPARATION);
    expect(contrast(dark.surfaceRaised, dark.bg)).toBeGreaterThanOrEqual(SURFACE_SEPARATION);
  });

  it('rejects the #F7F8FA canvas, which leaves white cards floating', () => {
    expect(contrast('#FFFFFF', '#F7F8FA')).toBeLessThan(SURFACE_SEPARATION);
    expect(contrast(light.surfaceRaised, light.bg)).toBeGreaterThanOrEqual(SURFACE_SEPARATION);
  });
});

describe('textFaint', () => {
  // Exempt from AA by design: it is for dividers, placeholders and disabled
  // states. Asserted explicitly so nobody "fixes" it into a body-text colour.
  it.each(SCHEMES)('%s textFaint is decoration-only and not AA-legible on a card', (name, t) => {
    expect(contrast(t.textFaint, t.surfaceRaised)).toBeLessThan(AA_TEXT);
  });
});
