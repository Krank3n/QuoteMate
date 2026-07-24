/**
 * Pure helpers for the adminTrafficStats GA report (analyticsTraffic.ts).
 */

/**
 * Hero A/B v2 launch date. On this date variant A gained the web-first
 * "Get my first quote" primary CTA (the mechanic that won v1), making it a
 * new test arm — so the A/B report must never mix in events from before it.
 * The GA query has no experiment_id filter (only the impression event carries
 * one); clamping the date range is what keeps the v2 read clean.
 */
export const AB_TEST_START = '2026-07-24';

/**
 * Start date for the hero A/B report: the requested `${days}daysAgo` window,
 * clamped so it never reaches back before the v2 launch. Returns a value for
 * the GA Data API `startDate` field (relative "NdaysAgo" or "YYYY-MM-DD").
 */
export function abStartDate(days: number, now: Date, epoch: string = AB_TEST_START): string {
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const iso = windowStart.toISOString().slice(0, 10);
  return iso >= epoch ? `${days}daysAgo` : epoch;
}
