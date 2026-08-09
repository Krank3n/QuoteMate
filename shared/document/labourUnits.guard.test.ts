import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

/**
 * Structural guardrail for the canonical labour model.
 *
 * Stored labour is hours and dollars-per-hour, always; days are a display
 * choice (`labourDisplayUnit`). The `StoredLabourUnit` type already stops a
 * day-shaped write at compile time — this test covers the hole underneath it,
 * where a future `as any` or an untyped object literal slips past the checker.
 *
 * It is deliberately a source scan rather than a behavioural test: the failure
 * mode being prevented is a NEW writer being added, and no behavioural test can
 * see code that does not exist yet. Three previous attempts at this bug all
 * guarded the conversion instead of the representation, and each time a new
 * writer reintroduced the two-unit state.
 *
 * If this fails, do not add an exemption — convert at the boundary with
 * normaliseLabourToHours and store hours.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const ROOTS = ['src', 'shared', 'functions/src', 'functions/scripts'];

/** Fixtures legitimately model legacy day-shaped records. */
const isTest = (p: string) => /\.test\.tsx?$/.test(p) || /__tests__/.test(p);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !isTest(full)) {
      out.push(full);
    }
  }
  return out;
}

function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

const FILES = ROOTS.flatMap((root) => {
  try {
    return sourceFiles(join(REPO, root));
  } catch {
    return [];
  }
});

describe('canonical labour units — source guardrail', () => {
  it('scans a meaningful number of files', () => {
    // Cheap sanity check: a broken path would make every assertion below pass.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it('no source file writes a day-shaped labour unit', () => {
    const offenders = FILES.filter((file) =>
      /\blaborUnit\s*:\s*['"]days['"]/.test(withoutComments(readFileSync(file, 'utf8'))),
    ).map((f) => relative(REPO, f));

    expect(offenders, [
      'These files store labour in days. Stored labour must be hours;',
      'days belong in labourDisplayUnit. See shared/document/labourUnits.ts.',
    ].join(' ')).toEqual([]);
  });

  it('no source file derives a stored labour rate by multiplying by a day length', () => {
    // `laborRate: rate * 8` is how a day rate got into storage in the first
    // place. Display conversion goes through rateForDisplay instead.
    const offenders = FILES.filter((file) => {
      const src = withoutComments(readFileSync(file, 'utf8'));
      return /laborRate\s*:\s*[^,;\n]*\*\s*(?:8|HOURS_PER_DAY|STANDARD_DAY_HOURS)\b/.test(src);
    }).map((f) => relative(REPO, f));

    expect(offenders, 'Build the rate per hour and convert at render time.').toEqual([]);
  });
});
