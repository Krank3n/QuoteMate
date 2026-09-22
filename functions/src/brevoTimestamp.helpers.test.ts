/**
 * Brevo event times. The `date` string is account-local with no offset and
 * was being read as UTC (10 h ahead for AEST); the epoch fields are exact.
 */
import { describe, expect, it } from 'vitest';

import { brevoEventMs } from './brevoTimestamp.helpers';

const NOW = 1_790_069_500_000; // 2026-09-22T09:31:40Z

describe('brevoEventMs', () => {
  it('prefers ts_epoch (ms), then ts_event / ts (seconds)', () => {
    expect(brevoEventMs({ ts_epoch: 1_790_069_490_000, ts_event: 1_790_069_000, date: '2026-09-22 19:31:30' }, NOW)).toBe(1_790_069_490_000);
    expect(brevoEventMs({ ts_event: 1_790_069_490, date: '2026-09-22 19:31:30' }, NOW)).toBe(1_790_069_490_000);
    expect(brevoEventMs({ ts: 1_790_069_490 }, NOW)).toBe(1_790_069_490_000);
  });

  it('falls back to the date string only when no epoch field exists', () => {
    expect(brevoEventMs({ date: '2026-09-22T09:31:30Z' }, NOW)).toBe(Date.parse('2026-09-22T09:31:30Z'));
  });

  it('never returns a time in the future — the account-local date string read as UTC on a UTC server', () => {
    // Node parses "YYYY-MM-DD HH:MM:SS" as LOCAL time, so the same string is 10 h off
    // on a UTC function host and correct on an AEST laptop — the clamp is asserted with
    // an unambiguous instant so the test means the same thing everywhere.
    expect(brevoEventMs({ date: '2026-09-23T19:31:30Z' }, NOW)).toBe(NOW);
    expect(brevoEventMs({ ts_event: 1_790_099_999 }, NOW)).toBe(NOW);
  });

  it('is null when nothing usable is present', () => {
    expect(brevoEventMs({}, NOW)).toBeNull();
    expect(brevoEventMs({ date: 'yesterday', ts: 'soon' }, NOW)).toBeNull();
    expect(brevoEventMs(null, NOW)).toBeNull();
  });
});
