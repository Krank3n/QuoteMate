/**
 * Guards the roles that react-native-paper overloads.
 *
 * Paper reuses single colour keys for unrelated jobs, and the mapping is only
 * visible if you read Paper's own source. Two have already bitten:
 *
 *  - `primary` is both a contained Button's fill and a text/outlined Button's
 *    LABEL. Pointing it at the vivid accent made every text button illegible
 *    on a white card.
 *  - `background` is the fill of an outlined TextInput and of the label notch
 *    that punches through its outline — it is NOT the app canvas. Pointing it
 *    at the canvas filled every outlined input with the cream ground, so form
 *    inputs read as dark grey-beige blocks on a white card and disappeared
 *    entirely when the input sat on the canvas itself.
 *
 * Both failures render fine in one theme and wrongly in the other, so a human
 * reviewing a diff in dark mode sees nothing. Hence tests.
 */

import { describe, it, expect, vi } from 'vitest';

// react-native-paper and @react-navigation/native ship source vite cannot parse
// ("Unexpected token 'typeof'"). Only the base theme objects matter here, and
// the point of the assertions is the keys we set OVER the base — so empty
// bases are not just acceptable, they make an accidental reliance on a Paper
// MD3 default show up as undefined.
vi.mock('react-native-paper', () => ({
  MD3DarkTheme: { colors: {} },
  MD3LightTheme: { colors: {} },
}));
vi.mock('@react-navigation/native', () => ({
  DarkTheme: { colors: {} },
  DefaultTheme: { colors: {} },
}));

import { buildPaperTheme } from './adapters';
import { light, dark, type Tokens, type SchemeName } from './semantic';
import { contrast, AA_TEXT } from './contrast';
import type { Theme } from './build';

const SCHEMES: Array<[SchemeName, Tokens]> = [
  ['light', light],
  ['dark', dark],
];

/** buildPaperTheme only reads `name` and `colors`. */
const themeFor = (name: SchemeName, colors: Tokens): Theme =>
  ({ name, colors } as unknown as Theme);

describe.each(SCHEMES)('paper theme (%s)', (name, tokens) => {
  const paper = buildPaperTheme(themeFor(name, tokens));

  it('fills outlined inputs with the card colour, not the app canvas', () => {
    // The actual defect: Paper reads `colors.background` for the outlined
    // TextInput fill, so `bg` here means every form input is painted the
    // canvas colour.
    expect(paper.colors.background).toBe(tokens.surfaceRaised);
    expect(paper.colors.background).not.toBe(tokens.bg);
  });

  it('keeps the input fill legible for the text typed into it', () => {
    // Whatever the fill is, onSurface is the colour of the typed value.
    expect(contrast(paper.colors.onSurface, paper.colors.background)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('uses the foreground accent for `primary`, since most buttons are text/outlined', () => {
    expect(paper.colors.primary).toBe(tokens.accentText);
    // The vivid fill is only ever legible as a background, never as a label.
    expect(paper.colors.primary).not.toBe(tokens.accent);
  });

  it('leaves no Paper MD3 default in the keys we deliberately set', () => {
    for (const key of [
      'primary',
      'background',
      'surface',
      'onSurface',
      'onSurfaceVariant',
      'surfaceVariant',
      'outline',
      'error',
    ] as const) {
      expect(paper.colors[key], `${key} is undefined`).toBeTruthy();
    }
  });
});
