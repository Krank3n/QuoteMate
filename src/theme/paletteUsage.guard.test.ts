/**
 * Scans real style blocks for unreadable colour pairs — in BOTH themes.
 *
 * Now that every screen builds styles from `makeStyles((t) => ...)`, a pair
 * written once has to work on two different grounds. A combination that is
 * fine in dark can fail in light, and nothing in tsc or the test suite would
 * notice; it only shows up on a screen. This closes that gap.
 *
 * Two shapes are checked:
 *
 *   1. Same-block pairs — one style object setting both backgroundColor and
 *      color.
 *   2. Sibling pairs — `sendButton` (the fill) next to `sendButtonText` (the
 *      label). This is the dominant convention here, and it is where every one
 *      of the twelve white-on-orange failures actually lived.
 *
 * Still blind to colours passed inline in JSX (`color={themeColors.x}` on an
 * icon), which have to be reviewed by eye.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { light, dark, type Tokens, type SchemeName } from './semantic';
import { contrast } from './contrast';

const SRC = resolve(__dirname, '..');
const THEME_DIR = resolve(__dirname);

/** Icons and large/bold labels; 3:1 is the applicable threshold. */
const MIN_RATIO = 3;

/** Suffixes a label style takes when its fill lives in a sibling key. */
const LABEL_SUFFIXES = ['Text', 'Label', 'Title', 'Icon', 'Value', 'TextActive', 'LabelActive'];

/**
 * Sibling naming is a heuristic, so it produces the occasional false positive:
 * a `fooLabel` that renders NEXT TO `foo` rather than inside it. Each entry
 * needs a reason, and the reason has to be something checked in the JSX.
 */
const NOT_ACTUALLY_STACKED = new Set<string>([
  // The label sits under the bar in a chart column, on the card — not on the
  // bar itself. See the chartBarWrapper render in ReferralScreen.
  'chartBar / chartBarLabel',
]);

function walk(dir: string, out: string[] = []): string[] {
  if (dir === THEME_DIR) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

interface Pair {
  file: string;
  key: string;
  fg: keyof Tokens;
  bg: keyof Tokens;
}

/** Matches both `t.colors.x` (inside makeStyles) and `themeColors.x` (in JSX). */
const TOKEN = String.raw`(?:t\.colors|themeColors)\.(\w+)`;

function findPairs(): Pair[] {
  const pairs: Pair[] = [];

  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    const backgrounds = new Map<string, string>();
    const foregrounds = new Map<string, string>();

    for (const match of source.matchAll(/(\w+)\s*:\s*\{([^{}]*)\}/g)) {
      const [, key, body] = match;
      const bgToken = body.match(new RegExp(String.raw`backgroundColor:\s*${TOKEN}\s*[,\n]`))?.[1];
      const fgToken = body.match(
        new RegExp(String.raw`(?:^|[^a-zA-Z])color:\s*${TOKEN}\s*[,\n]`),
      )?.[1];
      if (bgToken) backgrounds.set(key, bgToken);
      if (fgToken) foregrounds.set(key, fgToken);

      if (bgToken && fgToken) {
        pairs.push({ file: file.replace(SRC, 'src'), key, fg: fgToken as keyof Tokens, bg: bgToken as keyof Tokens });
      }
    }

    for (const [fillKey, bgToken] of backgrounds) {
      for (const suffix of LABEL_SUFFIXES) {
        const labelKey = fillKey + suffix;
        const fgToken = foregrounds.get(labelKey);
        if (!fgToken) continue;
        if (NOT_ACTUALLY_STACKED.has(`${fillKey} / ${labelKey}`)) continue;
        // `fooTextActive` renders on `fooActive`, not on the base `foo`. If a
        // dedicated active fill exists, that pairing is the real one and this
        // one is an artefact of the suffix match.
        if (suffix.endsWith('Active') && backgrounds.has(`${fillKey}Active`)) continue;
        pairs.push({
          file: file.replace(SRC, 'src'),
          key: `${fillKey} / ${labelKey}`,
          fg: fgToken as keyof Tokens,
          bg: bgToken as keyof Tokens,
        });
      }
    }
  }
  return pairs;
}

const SCHEMES: Array<[SchemeName, Tokens]> = [
  ['light', light],
  ['dark', dark],
];

describe('palette usage in real styles', () => {
  const pairs = findPairs();

  it('finds colour pairs to check', () => {
    expect(pairs.length).toBeGreaterThan(0);
  });

  it.each(SCHEMES)('has no unreadable foreground/background pair in %s', (name, tokens) => {
    const bad = pairs
      .map((p) => {
        const fg = tokens[p.fg];
        const bg = tokens[p.bg];
        // Translucent backgrounds composite over an unknown parent, so a ratio
        // would be a guess rather than a measurement.
        if (!fg || !bg || !bg.startsWith('#') || !fg.startsWith('#')) return null;
        return { ...p, ratio: contrast(fg, bg) };
      })
      .filter((p): p is Pair & { ratio: number } => !!p && p.ratio < MIN_RATIO);

    const report = bad
      .map((p) => `  ${p.file}  ${p.key}: ${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)}:1`)
      .join('\n');
    expect(bad, `Unreadable in ${name}:\n${report}`).toEqual([]);
  });

  it('never pairs the always-white token with the accent fill', () => {
    const bad = pairs.filter((p) => p.fg === 'alwaysLight' && p.bg === 'accent');
    expect(
      bad,
      `White on the accent is 2.80:1. Use onAccent:\n${bad.map((p) => `  ${p.file}  ${p.key}`).join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * `accent` is a FILL. It is the one token most likely to be misused as a
 * foreground, because the palette it replaced (`colors.primary`) was both —
 * which left 329 sites painting text and icons in the fill colour. At 2.35:1
 * on a white card that is illegible, and it is invisible in dark mode where
 * the same token happens to pass.
 */
describe('accent is fill-only', () => {
  const FOREGROUND = /color[:=]\s*\{?(?:t\.colors|themeColors)\.accent(?=[\s,\n}])/g;

  it('is never used as a text or icon colour', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, i) => {
        if (FOREGROUND.test(line)) offenders.push(`  ${file.replace(SRC, 'src')}:${i + 1}`);
        FOREGROUND.lastIndex = 0;
      });
    }
    expect(
      offenders,
      `\`accent\` is the fill colour — 2.35:1 as text on a white card.\n` +
        `Use \`accentText\` (light #B23C08, dark #FB923C) on surfaces, or\n` +
        `\`onAccent\` on top of an accent fill:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
