import { describe, expect, it } from 'vitest';
import { AB_TEST_START, abStartDate } from './analyticsTraffic.helpers';

describe('abStartDate — hero A/B window clamped to the v2 launch', () => {
  it('keeps the relative window when it starts after the v2 launch', () => {
    // 2026-08-30 minus 7 days = 2026-08-23, well after 2026-07-24.
    expect(abStartDate(7, new Date('2026-08-30T00:00:00Z'))).toBe('7daysAgo');
  });

  it('clamps to the launch date when the window reaches back before it', () => {
    // 2026-07-25 minus 28 days = 2026-06-27 — v1 territory.
    expect(abStartDate(28, new Date('2026-07-25T00:00:00Z'))).toBe(AB_TEST_START);
  });

  it('clamps the 90-day window shortly after launch', () => {
    expect(abStartDate(90, new Date('2026-08-01T00:00:00Z'))).toBe(AB_TEST_START);
  });

  it('keeps the relative window at the exact boundary day', () => {
    // 2026-07-31 minus 7 days = 2026-07-24 — the launch day itself is clean.
    expect(abStartDate(7, new Date('2026-07-31T00:00:00Z'))).toBe('7daysAgo');
  });

  it('respects an explicit epoch override', () => {
    expect(abStartDate(28, new Date('2026-07-25T00:00:00Z'), '2026-01-01')).toBe('28daysAgo');
  });
});
