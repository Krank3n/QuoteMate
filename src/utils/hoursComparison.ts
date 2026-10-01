/**
 * Quoted vs logged hours, job by job — "which jobs ran over my quote?".
 *
 * Only finished work with both sides counts: some logged time AND hourly
 * labour on the quote, on a job that's done (completed / paid / closed) or
 * already invoiced. A lump-sum quote has no hours to be over, and a job
 * still under way would read as "under" when it's simply not finished.
 */

import type { TimeEntry } from '../../shared/time/types';
import { sumBillableHours } from '../../shared/time/hours';
import { hourlyRateOf, quotedHoursOf } from './loggedHours';
import { labourCostOf, type LabourCostSettings } from '../../shared/time/labourCost';
import type { CrewMember } from '../../shared/time/types';

type LabourDoc = Parameters<typeof hourlyRateOf>[0] & { id: string; jobId?: string; stage?: string; laborTotal?: number };

export interface JobHoursRow {
  jobId: string;
  jobName: string;
  customerName?: string;
  quotedHours: number;
  loggedHours: number;
  /** (logged − quoted) ÷ quoted, as a whole percent. Positive = over. */
  overPercent: number;
  /** Latest day time was logged, YYYY-MM-DD — rows sort newest first. */
  lastLogged: string;
  /** What the crew's hours cost (super and on-costs in), when any are costed. */
  labourCost?: number;
  /** The labour on the job's quote or invoice, ex GST. */
  labourCharged: number;
}

export interface HoursComparison {
  rows: JobHoursRow[];
  totalQuoted: number;
  totalLogged: number;
  /** Across every compared job, whole percent. Null with nothing to compare. */
  overallOverPercent: number | null;
  jobsOver: number;
  /** Across the rows that have a crew cost: what it cost against the labour charged on them. */
  totalLabourCost: number;
  totalLabourChargedOnCosted: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const FINISHED_STAGES = new Set(['completed', 'paid', 'closed']);

export function buildHoursComparison(
  entries: Array<Pick<TimeEntry, 'jobId' | 'hours' | 'billable' | 'date'> & Partial<Pick<TimeEntry, 'workerId' | 'status' | 'cost'>>>,
  jobs: Array<{ id: string; name?: string; customerName?: string; primaryDocumentId?: string; stage?: string }>,
  documents: LabourDoc[],
  costing?: LabourCostSettings & { crew?: CrewMember[] },
): HoursComparison {
  const byJob = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byJob.get(e.jobId) ?? [];
    list.push(e);
    byJob.set(e.jobId, list);
  }

  const costOf = (list: typeof entries): { labourCost?: number } => {
    const c = labourCostOf(list.map((e) => ({ ...e, workerId: e.workerId || '' })), costing?.crew, costing);
    return c.costedHours > 0 ? { labourCost: c.total } : {};
  };

  const rows: JobHoursRow[] = [];
  for (const job of jobs) {
    const jobEntries = byJob.get(job.id);
    if (!jobEntries?.length) continue;
    const doc =
      (job.primaryDocumentId && documents.find((d) => d.id === job.primaryDocumentId)) ||
      documents.find((d) => d.jobId === job.id && d.stage !== 'cancelled');
    if (!doc || !(hourlyRateOf(doc) > 0)) continue;
    const finished = FINISHED_STAGES.has(job.stage ?? '') || (doc as { type?: string }).type === 'invoice';
    if (!finished) continue;
    const quotedHours = quotedHoursOf(doc);
    const loggedHours = sumBillableHours(jobEntries);
    if (!(quotedHours > 0) || !(loggedHours > 0)) continue;
    rows.push({
      jobId: job.id,
      jobName: job.name || 'Untitled job',
      customerName: job.customerName || undefined,
      quotedHours,
      loggedHours,
      overPercent: Math.round(((loggedHours - quotedHours) / quotedHours) * 100),
      lastLogged: jobEntries.reduce((max, e) => (e.date > max ? e.date : max), ''),
      labourCharged: round2(Number(doc.laborTotal) || 0),
      ...costOf(jobEntries),
    });
  }
  rows.sort((a, b) => (a.lastLogged === b.lastLogged ? 0 : a.lastLogged < b.lastLogged ? 1 : -1));

  const totalQuoted = round2(rows.reduce((s, r) => s + r.quotedHours, 0));
  const totalLogged = round2(rows.reduce((s, r) => s + r.loggedHours, 0));
  return {
    rows,
    totalQuoted,
    totalLogged,
    overallOverPercent: totalQuoted > 0 ? Math.round(((totalLogged - totalQuoted) / totalQuoted) * 100) : null,
    jobsOver: rows.filter((r) => r.overPercent > 0).length,
    totalLabourCost: round2(rows.reduce((s, r) => s + (r.labourCost ?? 0), 0)),
    totalLabourChargedOnCosted: round2(rows.reduce((s, r) => s + (r.labourCost !== undefined ? r.labourCharged : 0), 0)),
  };
}
