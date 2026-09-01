import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * No stale model pins in production source.
 *
 * A year-old pin is not just an old model: every swap off one uncovered a
 * live trap — `temperature` (400 on the Claude 5 family), `max_tokens` sized
 * before thinking-by-default existed, and `content[0]` parses that read a
 * thinking block (or silently returned '' via `|| ''`). Sweeping late means
 * paying all three at once, so staleness fails CI instead of accumulating.
 * Scripts and tests are exempt — they pin deliberately for comparisons.
 */
const BANNED = /claude-3-\d|claude-sonnet-4-5|claude-opus-4-[0-5]\b|claude-haiku-3/;

function scan(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|scripts|__tests__/.test(e.name)) continue;
      scan(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
      // Comments stripped: fix comments legitimately NAME the pin they removed.
      const src = fs
        .readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const m = src.match(BANNED);
      if (m) out.push(`${p}: ${m[0]}`);
    }
  }
  return out;
}

describe('model pins', () => {
  it('functions source carries no stale Claude pins', () => {
    expect(scan(__dirname)).toEqual([]);
  });

  it('app source carries no stale Claude pins', () => {
    expect(scan(path.join(__dirname, '..', '..', 'src'))).toEqual([]);
  });
});
