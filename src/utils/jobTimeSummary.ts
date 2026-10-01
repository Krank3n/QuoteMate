/**
 * Copy for the job screen's time row, kept apart from the component so it
 * can be tested without rendering React Native.
 */

import type { TimeEntry } from '../../shared/time/types';
import { formatHours, isCounted, sumBillableHours, sumHours } from '../../shared/time/hours';
import { hourlyRateOf, quotedHoursOf } from './loggedHours';

export function jobTimeSummary(
  allEntries: Array<Pick<TimeEntry, 'hours' | 'billable' | 'date'> & Partial<Pick<TimeEntry, 'status'>>>,
  primaryDoc: Parameters<typeof hourlyRateOf>[0] | null,
): { title: string; sub: string; over: boolean; waiting: number } {
  // Crew send-ins waiting for approval don't count yet — they're named, not summed.
  const entries = allEntries.filter(isCounted);
  const waiting = allEntries.length - entries.length;
  const waitingNote = waiting ? `${waiting} sent in, waiting for you` : '';
  const logged = sumHours(entries);
  const billable = sumBillableHours(entries);
  const quoted = primaryDoc && hourlyRateOf(primaryDoc) > 0 ? quotedHoursOf(primaryDoc) : 0;
  if (entries.length === 0) {
    return {
      title: 'Log time',
      sub:
        waitingNote ||
        (quoted > 0 ? `${formatHours(quoted)} quoted — track what it really takes` : 'Track the hours you put into this job'),
      over: false,
      waiting,
    };
  }
  const parts = [`${formatHours(logged)} logged`];
  if (quoted > 0) parts.push(`${formatHours(quoted)} quoted`);
  const over = quoted > 0 && billable > quoted;
  const dayCount = new Set(entries.map((e) => e.date)).size;
  const days = dayCount === 1 ? 'on 1 day' : `across ${dayCount} days`;
  const sub = over ? `${formatHours(billable - quoted)} over the quote · ${days}` : days;
  return {
    title: parts.join(' · '),
    sub: waitingNote ? `${waitingNote} · ${sub}` : sub,
    over,
    waiting,
  };
}
