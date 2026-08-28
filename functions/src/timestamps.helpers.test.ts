import { describe, it, expect } from 'vitest';
import { normaliseTimestamp, formatAuDate } from './timestamps.helpers';

/**
 * Regression cover for the "Invalid Date" bug on customer-facing PDFs.
 *
 * A prod sample of 400 quotes found 32 (8%) whose `documentDate || updatedAt`
 * was a Firestore Timestamp rather than epoch millis. The old formatter did
 * `new Date(value || Date.now())`, and `new Date(Timestamp)` is Invalid Date —
 * so the date line of the quote PDF the customer received read "Invalid Date".
 * It never threw, so nothing caught it.
 *
 * Times are pinned at 12:00 UTC so the rendered calendar day is the same in
 * UTC and in Australian zones (UTC+8..+11) and these don't flake by TZ.
 */

const AT_NOON_UTC = Date.UTC(2026, 7, 9, 12, 0, 0); // 9 Aug 2026
const EXPECTED = '09 August 2026';

describe('normaliseTimestamp', () => {
  it('unwraps a Firestore Timestamp via toDate() — THE BUG', () => {
    const timestamp = { toDate: () => new Date(AT_NOON_UTC) };
    expect(normaliseTimestamp(timestamp)?.getTime()).toBe(AT_NOON_UTC);
  });

  it('reads a JSON-round-tripped {_seconds,_nanoseconds}', () => {
    expect(normaliseTimestamp({ _seconds: AT_NOON_UTC / 1000, _nanoseconds: 0 })?.getTime())
      .toBe(AT_NOON_UTC);
  });

  it('reads a {seconds,nanoseconds} literal', () => {
    expect(normaliseTimestamp({ seconds: AT_NOON_UTC / 1000, nanoseconds: 0 })?.getTime())
      .toBe(AT_NOON_UTC);
  });

  it('passes through epoch millis, ISO strings and Dates', () => {
    expect(normaliseTimestamp(AT_NOON_UTC)?.getTime()).toBe(AT_NOON_UTC);
    expect(normaliseTimestamp(new Date(AT_NOON_UTC).toISOString())?.getTime()).toBe(AT_NOON_UTC);
    expect(normaliseTimestamp(new Date(AT_NOON_UTC))?.getTime()).toBe(AT_NOON_UTC);
  });

  it('returns null for missing or unparseable input, never Invalid Date', () => {
    for (const bad of [null, undefined, 'not a date', {}, new Date('nope'), { toDate: () => 'x' }]) {
      expect(normaliseTimestamp(bad)).toBeNull();
    }
  });

  it('does not throw when toDate() itself throws', () => {
    expect(normaliseTimestamp({ toDate: () => { throw new Error('boom'); } })).toBeNull();
  });
});

describe('formatAuDate', () => {
  it('formats a Firestore Timestamp as a real AU date, not "Invalid Date"', () => {
    const timestamp = { toDate: () => new Date(AT_NOON_UTC) };
    expect(formatAuDate(timestamp)).toBe(EXPECTED);
  });

  it('formats every other Firestore shape identically', () => {
    expect(formatAuDate(AT_NOON_UTC)).toBe(EXPECTED);
    expect(formatAuDate(new Date(AT_NOON_UTC).toISOString())).toBe(EXPECTED);
    expect(formatAuDate({ _seconds: AT_NOON_UTC / 1000, _nanoseconds: 0 })).toBe(EXPECTED);
    expect(formatAuDate({ seconds: AT_NOON_UTC / 1000, nanoseconds: 0 })).toBe(EXPECTED);
  });

  it('never emits the string "Invalid Date" for any input', () => {
    for (const bad of [null, undefined, 'not a date', {}, NaN, new Date('nope')]) {
      expect(formatAuDate(bad)).not.toContain('Invalid');
    }
  });

  it('falls back to today when the value is missing — the pre-existing contract', () => {
    const today = new Date().toLocaleDateString('en-AU', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
    expect(formatAuDate(undefined)).toBe(today);
    expect(formatAuDate(null)).toBe(today);
  });
});
