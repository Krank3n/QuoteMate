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

type LabourDoc = Parameters<typeof hourlyRateOf>[0] & { id: string; jobId?: string; stage?: string };

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
}

export interface HoursComparison {
  rows: JobHoursRow[];
  totalQuoted: number;
  totalLogged: number;
  /** Across every compared job, whole percent. Null with nothing to compare. */
  overallOverPercent: number | null;
  jobsOver: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const FINISHED_STAGES = new Set(['completed', 'paid', 'closed']);

export function buildHoursComparison(
  entries: Array<Pick<TimeEntry, 'jobId' | 'hours' | 'billable' | 'date'>>,
  jobs: Array<{ id: string; name?: string; customerName?: string; primaryDocumentId?: string; stage?: string }>,
  documents: LabourDoc[],
): HoursComparison {
  const byJob = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byJob.get(e.jobId) ?? [];
    list.push(e);
    byJob.set(e.jobId, list);
  }

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
  };
}
