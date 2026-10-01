/**
 * The Timesheets screen's week, grouped by who worked it. Pure, so the
 * grouping and totals are tested without Firestore.
 */

import type { CrewMember, TimeEntry } from '../../shared/time/types';
import { crewIdOf, isCounted } from '../../shared/time/hours';

export interface TimesheetPerson {
  /** 'me' for the owner, otherwise the crew member's id. */
  key: string;
  name: string;
  /** Approved hours — waiting time is shown, never counted. */
  total: number;
  waiting: number;
  /** Hours sent in and not approved yet. */
  waitingHours: number;
  entries: TimeEntry[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function personKeyOf(e: Pick<TimeEntry, 'workerId'>): string {
  return crewIdOf(e) ?? 'me';
}

export function buildTimesheetWeek(
  entries: TimeEntry[],
  crew: CrewMember[] | undefined,
  filter: string = 'all',
): { people: TimesheetPerson[]; waiting: TimeEntry[]; total: number } {
  const names = new Map((crew ?? []).map((c) => [c.id, c.name]));
  const groups = new Map<string, TimesheetPerson>();
  for (const e of entries) {
    const key = personKeyOf(e);
    if (filter !== 'all' && key !== filter) continue;
    const g = groups.get(key) ?? {
      key,
      name: key === 'me' ? 'You' : names.get(key) || e.workerName || 'Crew',
      total: 0,
      waiting: 0,
      waitingHours: 0,
      entries: [],
    };
    g.entries.push(e);
    if (isCounted(e)) g.total = round2(g.total + e.hours);
    else {
      g.waiting += 1;
      g.waitingHours = round2(g.waitingHours + e.hours);
    }
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    // Oldest day first within a person — reads like a timesheet.
    g.entries.sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1));
  }
  // You first, then crew by name.
  const people = [...groups.values()].sort((a, b) =>
    a.key === 'me' ? -1 : b.key === 'me' ? 1 : a.name.localeCompare(b.name),
  );
  const waiting = people.flatMap((p) => p.entries.filter((e) => !isCounted(e)));
  return { people, waiting, total: round2(people.reduce((t, p) => t + p.total, 0)) };
}
