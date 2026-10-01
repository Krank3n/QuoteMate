// Pure helpers for time entries — no Firestore, so client, server and tests
// all read hours the same way.

import { CREW_WORKER_PREFIX, type TimeEntry } from './types';

/** Approved time — everything except a crew member's unapproved send-in. */
export function isCounted(e: Pick<TimeEntry, 'status'>): boolean {
  return e.status !== 'pending';
}

/** The crew member id on an entry, or null for the owner's own time. */
export function crewIdOf(e: Pick<TimeEntry, 'workerId'>): string | null {
  return e.workerId?.startsWith(CREW_WORKER_PREFIX) ? e.workerId.slice(CREW_WORKER_PREFIX.length) : null;
}

/** Longest single entry we accept. A day has 24 of them. */
export const MAX_ENTRY_HOURS = 24;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Total approved hours across entries, rounded to the hundredth. */
export function sumHours(entries: Array<Pick<TimeEntry, 'hours'> & Partial<Pick<TimeEntry, 'status'>>>): number {
  return round2(
    entries.reduce(
      (sum, e) => sum + (isCounted(e) && Number.isFinite(e.hours) && e.hours > 0 ? e.hours : 0),
      0,
    ),
  );
}

/** Hours that go on an invoice — non-billable time is logged, never charged. */
export function sumBillableHours(
  entries: Array<Pick<TimeEntry, 'hours' | 'billable'> & Partial<Pick<TimeEntry, 'status'>>>,
): number {
  return sumHours(entries.filter((e) => e.billable !== false));
}

/** Hours per job id, for lists that cover many jobs. */
export function hoursByJob(
  entries: Array<Pick<TimeEntry, 'jobId' | 'hours' | 'billable'> & Partial<Pick<TimeEntry, 'status'>>>,
  { billableOnly = false }: { billableOnly?: boolean } = {},
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (!isCounted(e)) continue;
    if (billableOnly && e.billable === false) continue;
    if (!(Number.isFinite(e.hours) && e.hours > 0)) continue;
    out.set(e.jobId, round2((out.get(e.jobId) ?? 0) + e.hours));
  }
  return out;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "7:30" → 450 (minutes past midnight), or null when it isn't a time. */
export function parseClock(value: string | undefined): number | null {
  const m = TIME_RE.exec(String(value ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Hours between a start and a finish on the same day, less any break.
 * Null when either time is unreadable or the finish isn't after the start —
 * an overnight shift is two entries, not a negative one.
 */
export function hoursBetween(start: string, end: string, breakMinutes = 0): number | null {
  const s = parseClock(start);
  const e = parseClock(end);
  if (s === null || e === null || e <= s) return null;
  const minutes = e - s - Math.max(0, breakMinutes);
  if (minutes <= 0) return null;
  return round2(minutes / 60);
}

/** A number of hours we'd store: positive, finite, at most one day. */
export function isValidEntryHours(hours: unknown): hours is number {
  return typeof hours === 'number' && Number.isFinite(hours) && hours > 0 && hours <= MAX_ENTRY_HOURS;
}

/** YYYY-MM-DD for a local date. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day in YYYY-MM-DD form. */
export function isDateKey(value: unknown): value is string {
  const m = DATE_KEY_RE.exec(String(value ?? ''));
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return localDateKey(d) === value;
}

/** Local date `daysAgo` days before `now`. */
export function dateKeyDaysAgo(daysAgo: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  return localDateKey(d);
}

/** Newest day first; within a day, most recently logged first. */
export function sortEntriesNewestFirst<T extends Pick<TimeEntry, 'date' | 'createdAt'>>(entries: T[]): T[] {
  return [...entries].sort((a, b) =>
    a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1,
  );
}

/** "12.5 h", "1 h", "0.25 h" — never "12.50 h". */
export function formatHours(hours: number): string {
  return `${round2(hours)} h`;
}

/**
 * What the tradie typed in the hours box, as hours. Takes "7.5", "7,5"
 * (comma decimal keyboards) and "7:30" (hours and minutes). Null when it
 * isn't a storable figure.
 */
export function parseHoursInput(raw: string): number | null {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (!text) return null;
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  const hours = hm ? Number(hm[1]) + Number(hm[2]) / 60 : /^\d*\.?\d+$/.test(text) ? Number(text) : NaN;
  const rounded = round2(hours);
  return isValidEntryHours(rounded) ? rounded : null;
}
