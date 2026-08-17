/**
 * Catches "Rendered fewer hooks than expected" before it ships.
 *
 * A screen that renders a not-found state with an early `return` must run every
 * hook ABOVE that return. React counts hooks per render: if the guard fires and
 * a hook below it is skipped, the render throws — a red box in dev and a crash
 * in release.
 *
 * This is not hypothetical. ViewJobScreen kept a `warmEmailDraft` useEffect
 * below its `if (!job)` guard, so deleting a job from the Actions menu — the
 * moment `job` becomes undefined while the screen is still mounted — crashed
 * the screen every time (ViewJobScreen.tsx:69, 17 Aug 2026). The file already
 * carried a comment explaining that another value had been hoisted above the
 * guard for exactly this reason; the effect was simply missed. A comment can be
 * missed. A test cannot.
 *
 * The rule enforced: in a screen component, no hook call may appear after a
 * top-level early `return` inside that component.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCREENS = resolve(__dirname);

const HOOK_CALL = /\buse[A-Z]\w*\s*\(/;
/** A top-level `if (...) {` — two-space indent, i.e. directly in the component. */
const TOP_LEVEL_IF = /^ {2}if \(/;
/** A top-level `return` that ends the component's render early. */
const TOP_LEVEL_RETURN = /^ {4}return \(|^ {4}return null;|^ {2}return \(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Find hook calls that sit after a top-level guard return inside the SAME
 * component. Scoped conservatively: only counts a guard once we've seen a
 * two-space-indented `if (` whose block contains a top-level return, and stops
 * at the next top-level `function`/`const X = (` declaration (a new component).
 */
function hooksAfterGuardReturn(source: string): { line: number; text: string }[] {
  const lines = source.split('\n');
  const offenders: { line: number; text: string }[] = [];
  let guardSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A new top-level declaration starts a fresh component scope.
    if (/^(export )?(default )?function \w+|^(export )?const \w+ = (React\.)?(memo|forwardRef)?\(?\(/.test(line)) {
      guardSeen = false;
    }

    if (TOP_LEVEL_IF.test(line)) {
      // Look ahead a few lines for an early return inside this guard block.
      const block = lines.slice(i, i + 8).join('\n');
      if (TOP_LEVEL_RETURN.test(block) || /^ {4}return/m.test(block)) guardSeen = true;
      continue;
    }

    if (!guardSeen) continue;
    // Only flag hooks at component top level (two-space indent) — hooks nested
    // deeper are inside callbacks or nested components.
    if (/^ {2}(const |let |void |)?.*/.test(line) && HOOK_CALL.test(line) && /^ {2}\S/.test(line)) {
      offenders.push({ line: i + 1, text: line.trim() });
    }
  }
  return offenders;
}

describe('screens never call hooks after an early return', () => {
  const files = walk(SCREENS);

  it('scans a meaningful number of screens', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const rel = file.slice(SCREENS.length + 1);
    it(`${rel} runs every hook above its guard returns`, () => {
      const offenders = hooksAfterGuardReturn(readFileSync(file, 'utf8'));
      expect(
        offenders,
        offenders.length
          ? `Hook(s) below an early return in ${rel} — React will throw ` +
            `"Rendered fewer hooks than expected" whenever that guard fires:\n` +
            offenders.map((o) => `  ${rel}:${o.line}  ${o.text}`).join('\n')
          : undefined,
      ).toEqual([]);
    });
  }
});
