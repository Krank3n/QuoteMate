/**
 * Hours for a period — the pure core behind the timesheet PDF and CSV.
 *
 * Every entry whose day falls inside the period, oldest first, with the job
 * and customer it was worked for, plus a subtotal per job. Days are the
 * tradie's local YYYY-MM-DD keys as logged, so a period is compared on keys,
 * never on instants: an entry logged for "Tuesday" stays on Tuesday whatever
 * zone the PDF is made in.
 *
 * Pure: no Firebase, no clock.
 */

import type { CrewMember, TimeEntry } from './types';
import { crewIdOf, formatHours, isCounted } from './hours';
import { csvField } from '../statement/buildStatement';

export interface TimesheetRange {
  /** First day, inclusive, YYYY-MM-DD. */
  fromKey: string;
  /** Last day, inclusive, YYYY-MM-DD. */
  toKey: string;
}

export interface TimesheetJobInput {
  id: string;
  name?: string;
  customerName?: string;
}

export interface TimesheetRow {
  date: string;
  jobId: string;
  jobName: string;
  customerName: string;
  hours: number;
  billable: boolean;
  note: string;
  workerName: string;
}

export interface TimesheetJobSubtotal {
  jobId: string;
  jobName: string;
  customerName: string;
  hours: number;
  billableHours: number;
  entryCount: number;
}

export interface TimesheetWorkerSubtotal {
  workerId: string;
  workerName: string;
  hours: number;
  /** hours × the crew member's cost rate, when one is set. */
  cost?: number;
}

export interface TimesheetData {
  range: TimesheetRange;
  rows: TimesheetRow[];
  byJob: TimesheetJobSubtotal[];
  /** Hours per person — the payroll view. */
  byWorker: TimesheetWorkerSubtotal[];
  totalHours: number;
  billableHours: number;
  /** Distinct days with any time logged. */
  daysWorked: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The job a deleted job's entries print under — kept, never dropped. */
export const DELETED_JOB_NAME = 'Job no longer on file';

export function buildTimesheet(
  entries: Array<
    Pick<TimeEntry, 'jobId' | 'date' | 'hours' | 'billable' | 'note' | 'workerName' | 'createdAt'> &
      Partial<Pick<TimeEntry, 'status' | 'workerId'>>
  >,
  jobs: TimesheetJobInput[],
  range: TimesheetRange,
  crew: Array<Pick<CrewMember, 'id' | 'name' | 'costRate'>> = [],
): TimesheetData {
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const inRange = entries.filter(
    // Unapproved crew send-ins aren't time yet — they wait on the job for the owner.
    (e) => isCounted(e) && e.date >= range.fromKey && e.date <= range.toKey && Number.isFinite(e.hours) && e.hours > 0,
  );
  inRange.sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1));

  const crewById = new Map(crew.map((c) => [c.id, c]));
  const workers = new Map<string, TimesheetWorkerSubtotal>();
  for (const e of inRange) {
    const key = e.workerId || '';
    const crewId = e.workerId ? crewIdOf({ workerId: e.workerId }) : null;
    const member = crewId ? crewById.get(crewId) : undefined;
    const w = workers.get(key) ?? { workerId: key, workerName: member?.name || e.workerName || 'You', hours: 0 };
    w.hours = round2(w.hours + e.hours);
    if (member?.costRate && member.costRate > 0) w.cost = round2(w.hours * member.costRate);
    workers.set(key, w);
  }

  const rows: TimesheetRow[] = inRange.map((e) => {
    const job = jobsById.get(e.jobId);
    return {
      date: e.date,
      jobId: e.jobId,
      jobName: job ? job.name || 'Untitled job' : DELETED_JOB_NAME,
      customerName: job?.customerName || '',
      hours: round2(e.hours),
      billable: e.billable !== false,
      note: e.note || '',
      workerName: (e.workerId ? crewById.get(crewIdOf({ workerId: e.workerId }) ?? '')?.name : undefined) || e.workerName || '',
    };
  });

  const subtotals = new Map<string, TimesheetJobSubtotal>();
  for (const r of rows) {
    const s = subtotals.get(r.jobId) ?? {
      jobId: r.jobId,
      jobName: r.jobName,
      customerName: r.customerName,
      hours: 0,
      billableHours: 0,
      entryCount: 0,
    };
    s.hours = round2(s.hours + r.hours);
    if (r.billable) s.billableHours = round2(s.billableHours + r.hours);
    s.entryCount += 1;
    subtotals.set(r.jobId, s);
  }

  return {
    range,
    rows,
    byJob: [...subtotals.values()].sort((a, b) => b.hours - a.hours),
    byWorker: [...workers.values()].sort((a, b) => b.hours - a.hours),
    totalHours: round2(rows.reduce((sum, r) => sum + r.hours, 0)),
    billableHours: round2(rows.filter((r) => r.billable).reduce((sum, r) => sum + r.hours, 0)),
    daysWorked: new Set(rows.map((r) => r.date)).size,
  };
}

/**
 * One row per entry, dates YYYY-MM-DD, hours as plain numbers — opens
 * straight into a spreadsheet or a payroll import. Text goes through the
 * statement's csvField, so a note starting with "=" stays text in Excel.
 */
export function timesheetToCsv(data: TimesheetData): string {
  const lines = [['date', 'job', 'customer', 'hours', 'charged', 'note', 'worked by'].join(',')];
  for (const r of data.rows) {
    lines.push(
      [
        r.date,
        csvField(r.jobName),
        csvField(r.customerName),
        r.hours,
        r.billable ? 'yes' : 'no',
        csvField(r.note),
        csvField(r.workerName),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** "42.5 h over 9 days · 38 h charged" — the summary line on screen and in the PDF. */
export function timesheetSummaryLine(data: TimesheetData): string {
  if (data.rows.length === 0) return 'No time logged in this period';
  const days = data.daysWorked === 1 ? '1 day' : `${data.daysWorked} days`;
  const charged =
    data.billableHours === data.totalHours ? '' : ` · ${formatHours(data.billableHours)} charged`;
  return `${formatHours(data.totalHours)} over ${days}${charged}`;
}
