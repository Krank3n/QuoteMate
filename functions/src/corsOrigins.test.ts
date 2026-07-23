/**
 * Regression tests for the HTTP-function CORS allowlist.
 *
 * Jul 2026: the staging hosting site (quotemate-staging.web.app) was missing
 * from allowedOrigins, so every fetch from the staging web build failed as an
 * opaque "TypeError: Failed to fetch" — presenting as silently-disabled send
 * buttons (empty generated email body → disabled Send Invoice) and a dead
 * Mate/Square/price-search surface for staging testers.
 *
 * index.ts pulls in the whole functions graph, so assert against the source
 * text instead of importing it — keeps this test dependency-free and fast.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function extractAllowedOrigins(): string[] {
  const src = readFileSync(join(__dirname, 'index.ts'), 'utf8');
  const match = src.match(/export const allowedOrigins = \[([\s\S]*?)\];/);
  if (!match) throw new Error('allowedOrigins array not found in index.ts');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('functions CORS allowlist', () => {
  it('includes the staging hosting origins (regression: silent staging-web fetch failures)', () => {
    const origins = extractAllowedOrigins();
    expect(origins).toContain('https://quotemate-staging.web.app');
    expect(origins).toContain('https://quotemate-staging.firebaseapp.com');
  });

  it('still includes every production origin', () => {
    const origins = extractAllowedOrigins();
    expect(origins).toContain('https://hansendev.web.app');
    expect(origins).toContain('https://hansendev.firebaseapp.com');
    expect(origins).toContain('https://quotemateapp.au');
    expect(origins).toContain('https://www.quotemateapp.au');
  });

  it('contains only https origins with no trailing slashes', () => {
    for (const o of extractAllowedOrigins()) {
      expect(o).toMatch(/^https:\/\/[^/]+$/);
    }
  });
});
