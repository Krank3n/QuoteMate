import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { TRIAL_MS } from './subscription.helpers';

/**
 * Copy guardrails for user-facing email/push templates. These are project
 * rules, not style preferences:
 *   - never the word "AI" in user-facing copy (describe the outcome instead);
 *   - Aussie + gender-neutral — no "blokes/guys/fancy/folks";
 *   - the trial is 14 days everywhere (a "7-day trial" claim shipped once);
 *   - no quote-quota claims — the free plan is unlimited (decision 2026-07-05).
 *
 * The templates are inline literals, so the pragmatic check is a source scan
 * with comments stripped (rules bind copy, not code commentary). If a banned
 * word is ever needed in an inline trailing comment, make it a full-line
 * comment instead.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const COPY_FILES = ['email.ts', 'aussieNotifications.ts'];

function copySource(file: string): string {
  return readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/^[ \t]*\/\/.*$/gm, ''); // full-line comments
}

describe.each(COPY_FILES)('user-facing copy rules — %s', (file) => {
  const src = copySource(file);

  it('never says "AI"', () => {
    const hits = src.match(/^.*\bAI\b.*$/gm) || [];
    expect(hits).toEqual([]);
  });

  it('stays gender-neutral (no blokes/guys/fancy/folks)', () => {
    const hits = src.match(/^.*\b(blokes?|guys|folks|fancy)\b.*$/gim) || [];
    expect(hits).toEqual([]);
  });
});

describe('email.ts claim accuracy', () => {
  const src = copySource('email.ts');

  it('never claims a 7-day trial (trial is 14 days)', () => {
    expect(src).not.toMatch(/7[- ]day free trial/i);
    expect(src).not.toMatch(/for 7 days/i);
  });

  it('never claims a monthly quote quota (free plan is unlimited)', () => {
    expect(src).not.toMatch(/quotes? (remaining|left) this month/i);
    expect(src).not.toMatch(/running low on quotes/i);
  });

  it('trial-length copy matches the real trial window', () => {
    expect(TRIAL_MS).toBe(14 * 24 * 60 * 60 * 1000);
    expect(src).toMatch(/14[- ]day free trial/i);
  });

  it('never hardcodes the post-cap price (use NEXT_PRICE_AUD from foundingOffer)', () => {
    const hits = src.match(/^.*\$(?:99|658)\b.*$/gm) || [];
    expect(hits).toEqual([]);
  });
});
