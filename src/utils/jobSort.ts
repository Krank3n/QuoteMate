/**
 * How the Jobs list is ordered.
 *
 * The existing rule — sort by the timestamp the card prints — was written to
 * fix a specific complaint: Firestore's `orderBy('updatedAt')` disagreed with
 * the date on each card, so a row saying "Quote sent 6 days ago" could sit
 * above "Created 11 days ago" and the ordering read as no ordering at all
 * (see jobStatusTimestamp).
 *
 * Adding sort options can't break that. So the rule generalises rather than
 * loosens:
 *
 *   THE CARD ALWAYS SHOWS THE VALUE THE LIST IS SORTED BY.
 *
 * Three of the four new sorts need no new card text at all — "Biggest $" is
 * explained by the headline price the card already prints, "Soonest start" by
 * the scheduled line, and "Oldest first" by the same stage date as the default.
 * Only "Most overdue" needed a label, which is why jobSortLabel exists and why
 * a test asserts every sort key has one.
 *
 * Two further invariants, both machine-checked in jobSort.test.ts:
 *
 *   - A SORT NEVER CHANGES THE SET. The chip says "Scheduled (7)", so the list
 *     must render 7 rows. Jobs missing the sort field sink to the bottom; they
 *     are never filtered out. Only a filter may change the set.
 *   - EVERY SORT IS A TOTAL ORDER. Same input, same output, whatever order it
 *     arrived in — otherwise the list jitters on unrelated re-renders.
 */

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';
import { jobStatusTimestamp, sortJobsForList } from './jobTimeline';
import { toMs } from './followUpNudge';

/** Amounts within half a cent are settled. Mirrors jobBuckets / derivePaymentState. */
const EPSILON = 0.005;

const DAY_MS = 24 * 60 * 60 * 1000;

export type JobSortKey = 'recent' | 'oldest' | 'value' | 'scheduled' | 'overdue';

export const JOB_SORTS: { key: JobSortKey; label: string; icon: string }[] = [
  { key: 'recent', label: 'Recent', icon: 'clock-outline' },
  { key: 'oldest', label: 'Oldest first', icon: 'history' },
  { key: 'value', label: 'Biggest $', icon: 'cash' },
  { key: 'scheduled', label: 'Soonest start', icon: 'calendar-clock-outline' },
  { key: 'overdue', label: 'Most overdue', icon: 'alert-circle-outline' },
];

export function isJobSortKey(v: unknown): v is JobSortKey {
  return typeof v === 'string' && JOB_SORTS.some((s) => s.key === v);
}

export function jobSortMeta(key: JobSortKey) {
  return JOB_SORTS.find((s) => s.key === key) ?? JOB_SORTS[0];
}

// --- Money ------------------------------------------------------------------

export type JobMoneyKind = 'owing' | 'paid' | 'quoted' | 'none';

export interface JobMoney {
  value: number;
  kind: JobMoneyKind;
}

/** Outstanding balance on one invoice, computed rather than read. */
function invoiceBalance(doc: Document): number {
  const total = Number(doc.total) || 0;
  const paid = Number(doc.paidTotal) || 0;
  const owing = total - paid;
  return owing > EPSILON ? owing : 0;
}

/**
 * The headline number for a job — the big figure the card prints top-right.
 *
 * Precedence matches JobDetailHeader and the card: outstanding balance once
 * anything has been invoiced, what's been paid once that's cleared, otherwise
 * the quoted total.
 *
 * Balances are recomputed as `total - paidTotal`, NOT read from the stored
 * `balanceDue`. The card used to sum the stored field while jobBuckets and
 * paidTransition both deliberately recomputed — so the green price and the
 * chip counts were derived by different rules and a job with a stale
 * `balanceDue` disagreed with its own filter pile. One rule now, here.
 *
 * Clamping happens per invoice before summing: summing raw differences first
 * would let one overpaid invoice mask another invoice's debt.
 */
export function jobHeadlineValue(docs: Document[]): JobMoney {
  const live = (docs || []).filter((d) => d && d.stage !== 'cancelled');

  let totalQuoted = 0;
  let totalInvoiced = 0;
  let totalPaid = 0;
  let owing = 0;

  for (const d of live) {
    const total = Number(d.total) || 0;
    if (d.type === 'quote') totalQuoted += total;
    if (d.type === 'invoice') {
      totalInvoiced += total;
      owing += invoiceBalance(d);
    }
    totalPaid += Number(d.paidTotal) || 0;
  }

  if (totalInvoiced > 0) {
    if (owing > EPSILON) return { value: owing, kind: 'owing' };
    return totalPaid > 0 ? { value: totalPaid, kind: 'paid' } : { value: 0, kind: 'none' };
  }
  if (totalQuoted > 0) return { value: totalQuoted, kind: 'quoted' };
  return { value: 0, kind: 'none' };
}

// --- Metrics ----------------------------------------------------------------

export interface JobSortMetrics {
  /** The timestamp the card prints. 0 when the job has no usable date. */
  statusMs: number;
  money: JobMoney;
  /** Scheduled start, or null when the job isn't booked in. */
  startMs: number | null;
  /** Ms past due on the job's worst live unpaid invoice, or null. */
  overdueMs: number | null;
  /** Balance on that worst invoice, for the card's overdue label. */
  overdueAmount: number;
}

/**
 * How overdue a job is, and by how much money.
 *
 * Due date falls back to `sentAt` when the invoice carries no explicit
 * `dueDate` — it's optional on the type, and this mirrors the fallback
 * StickyJobActionBar already uses for its follow-up escalation. An invoice
 * with neither date isn't overdue; it just isn't measurable.
 *
 * Takes the WORST offender when a job has several unpaid invoices, so the
 * order reflects the oldest debt rather than an average.
 */
function overdueFor(docs: Document[], now: number): { ms: number | null; amount: number } {
  let worstMs: number | null = null;
  let amount = 0;

  for (const d of docs || []) {
    if (!d || d.type !== 'invoice' || d.stage === 'cancelled') continue;
    const balance = invoiceBalance(d);
    if (balance <= 0) continue;

    const dueMs = toMs(d.dueDate) ?? toMs(d.sentAt);
    if (!dueMs) continue;

    const past = now - dueMs;
    if (past <= 0) continue;

    if (worstMs === null || past > worstMs) {
      worstMs = past;
      amount = balance;
    }
  }

  return { ms: worstMs, amount };
}

/**
 * @param now Frozen for the caller's session — pass startOfDay(Date.now()).
 *   Overdue is a day-granularity idea, so re-ticking it per render would only
 *   make the comparators non-deterministic and the tests unwritable.
 */
export function buildJobSortMetrics(
  jobs: Job[],
  docsByJob: Map<string, Document[]>,
  now: number,
): Map<string, JobSortMetrics> {
  const out = new Map<string, JobSortMetrics>();
  for (const job of jobs) {
    if (!job?.id) continue;
    const docs = docsByJob.get(job.id) ?? [];
    const overdue = overdueFor(docs, now);
    out.set(job.id, {
      statusMs: jobStatusTimestamp(job),
      money: jobHeadlineValue(docs),
      startMs: toMs(job.scheduledStartDate),
      overdueMs: overdue.ms,
      overdueAmount: overdue.amount,
    });
  }
  return out;
}

// --- Comparators ------------------------------------------------------------

const EMPTY_METRICS: JobSortMetrics = {
  statusMs: 0,
  money: { value: 0, kind: 'none' },
  startMs: null,
  overdueMs: null,
  overdueAmount: 0,
};

function metricsFor(m: Map<string, JobSortMetrics>, job: Job): JobSortMetrics {
  return m.get(job.id) ?? EMPTY_METRICS;
}

/**
 * Shared tiebreak, applied under every primary key: the date the card prints,
 * then updatedAt, then id.
 *
 * statusMs comes first (rather than jumping straight to updatedAt) so rows
 * that tie on the primary key still fall back to the recency order the user
 * already knows from the default sort. The id makes it a total order, so the
 * list can't reshuffle between renders.
 */
function tiebreak(a: Job, b: Job, ma: JobSortMetrics, mb: JobSortMetrics): number {
  const byStatus = mb.statusMs - ma.statusMs;
  if (byStatus !== 0) return byStatus;
  const byUpdated = (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  if (byUpdated !== 0) return byUpdated;
  return String(a.id).localeCompare(String(b.id));
}

export function sortJobsBy<T extends Job>(
  jobs: T[],
  key: JobSortKey,
  metrics: Map<string, JobSortMetrics>,
): T[] {
  // Delegate the shipped default rather than reimplementing it — a test
  // asserts the two stay identical, so the default can't regress here.
  if (key === 'recent') return sortJobsForList(jobs);

  const compare = (a: T, b: T): number => {
    const ma = metricsFor(metrics, a);
    const mb = metricsFor(metrics, b);

    switch (key) {
      case 'oldest': {
        // NOT 'recent' reversed. An undated job has statusMs 0, and a naive
        // ascending sort would promote those to the very top — inverting the
        // "undated sinks" rule the default sort guarantees. Treat missing as
        // infinitely far in the future so it still sinks.
        const av = ma.statusMs || Number.POSITIVE_INFINITY;
        const bv = mb.statusMs || Number.POSITIVE_INFINITY;
        if (av !== bv) return av - bv;
        break;
      }
      case 'value': {
        if (mb.money.value !== ma.money.value) return mb.money.value - ma.money.value;
        break;
      }
      case 'scheduled': {
        // Past dates included, deliberately. A start date that has already
        // passed is an overrun and belongs at the top — sinking it would hide
        // exactly the job that needs attention. Unscheduled jobs sink.
        const av = ma.startMs ?? Number.POSITIVE_INFINITY;
        const bv = mb.startMs ?? Number.POSITIVE_INFINITY;
        if (av !== bv) return av - bv;
        break;
      }
      case 'overdue': {
        const av = ma.overdueMs ?? -1;
        const bv = mb.overdueMs ?? -1;
        if (av !== bv) return bv - av;
        break;
      }
    }

    return tiebreak(a, b, ma, mb);
  };

  return [...jobs].sort(compare);
}

// --- Card label -------------------------------------------------------------

export interface JobSortLabel {
  icon: string;
  text: string;
  tone?: 'urgent';
}

/**
 * What the card should print to justify the current order, or null when the
 * card already shows it (the price for 'value', the scheduled line for
 * 'scheduled', the stage date for 'recent' / 'oldest').
 */
export function jobSortLabel(key: JobSortKey, m: JobSortMetrics): JobSortLabel | null {
  if (key !== 'overdue') return null;
  if (m.overdueMs === null) return null;

  const days = Math.max(1, Math.floor(m.overdueMs / DAY_MS));
  return {
    icon: 'alert-circle-outline',
    text: `Overdue ${days} ${days === 1 ? 'day' : 'days'}`,
    tone: 'urgent',
  };
}
