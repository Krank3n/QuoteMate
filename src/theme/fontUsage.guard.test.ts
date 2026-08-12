/**
 * Catches the silent Android font bug across the whole codebase.
 *
 * React Native does not synthesise weights for custom fonts. When a style sets
 * BOTH `fontFamily: 'Archivo-Bold'` and `fontWeight: '700'`, Android drops the
 * weight and renders Archivo Regular. No error, no warning, no crash — the app
 * just looks subtly wrong, and only on Android. iOS happens to honour it, so
 * this is exactly the class of bug that ships.
 *
 * Also verifies that every Archivo family referenced anywhere actually has a
 * font file registered, since a typo'd family name falls back to the system
 * font just as silently.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FONT_ASSETS } from './typography';

const SRC = resolve(__dirname, '..');
const THEME_DIR = resolve(__dirname);

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

interface Violation {
  file: string;
  key: string;
  family: string;
  weight: string;
}

function scan() {
  const violations: Violation[] = [];
  const families = new Set<string>();

  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(\w+)\s*:\s*\{([^{}]*)\}/g)) {
      const [, key, body] = match;
      const family = body.match(/fontFamily:\s*['"`](Archivo[^'"`]*)['"`]/)?.[1];
      if (!family) continue;
      families.add(family);
      const weight = body.match(/fontWeight:\s*['"`]?([0-9a-z]+)['"`]?/)?.[1];
      if (weight) {
        violations.push({ file: file.replace(SRC, 'src'), key, family, weight });
      }
    }
    // Inline JSX styles too — `style={{ fontFamily: 'Archivo-Bold', fontWeight: '700' }}`
    for (const match of source.matchAll(/fontFamily:\s*['"`](Archivo[^'"`]*)['"`]/g)) {
      families.add(match[1]);
    }
  }
  return { violations, families };
}

describe('custom font usage', () => {
  const { violations, families } = scan();

  it('finds Archivo in use', () => {
    // Guards against the scan silently matching nothing after a refactor.
    expect(families.size).toBeGreaterThan(0);
  });

  it('never sets fontWeight alongside an Archivo fontFamily', () => {
    const report = violations
      .map((v) => `  ${v.file}  ${v.key}: ${v.family} + fontWeight '${v.weight}'`)
      .join('\n');
    expect(
      violations,
      `Android ignores fontWeight when fontFamily is set — these render Regular:\n${report}`,
    ).toEqual([]);
  });

  it('only references families that have a font file registered', () => {
    const registered = Object.keys(FONT_ASSETS);
    for (const family of families) {
      expect(
        registered,
        `fontFamily '${family}' is used but not in FONT_ASSETS — falls back to the system font silently`,
      ).toContain(family);
    }
  });
});
