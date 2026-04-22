/**
 * Shared formatters for Job scheduling. Kept in one place so the JobCard,
 * the ViewJobScreen, and the ScheduleJobSheet all render timestamps the
 * same way.
 */

import { format } from 'date-fns';

/**
 * Return the time-of-day suffix of a scheduled-start timestamp, or null if
 * the timestamp is exactly local midnight (the "date-only" convention used
 * by the original sheet and the fromIsoDay helper).
 */
export function formatScheduledTime(ms?: number): string | null {
  if (!ms) return null;
  try {
    const d = new Date(ms);
    if (d.getHours() === 0 && d.getMinutes() === 0) return null;
    return format(d, 'h:mm a').toLowerCase();
  } catch {
    return null;
  }
}

/** "Wed 23 Apr" — day-level formatting, regardless of time-of-day. */
export function formatScheduledDate(ms?: number): string | null {
  if (!ms) return null;
  try {
    return format(new Date(ms), 'EEE d MMM');
  } catch {
    return null;
  }
}

/** Longer variant for the detail screen: "Wed 23 Apr 2026". */
export function formatScheduledDateLong(ms?: number): string | null {
  if (!ms) return null;
  try {
    return format(new Date(ms), 'EEE d MMM yyyy');
  } catch {
    return null;
  }
}

/**
 * Combined "Wed 23 Apr · 9:00 am" when time is set, plain "Wed 23 Apr"
 * when it's a date-only schedule. Returns null if nothing is scheduled.
 */
export function formatScheduledDateTime(ms?: number): string | null {
  const day = formatScheduledDate(ms);
  if (!day) return null;
  const time = formatScheduledTime(ms);
  return time ? `${day} · ${time}` : day;
}
