/**
 * Which pile a job belongs in on the Jobs list.
 *
 * The old filters bucketed by lifecycle stage, which meant "Active" held 43
 * of 44 jobs and "Completed" held none — two rows of chips that separated
 * nothing. These bucket by what the job needs from you instead, which is the
 * question a tradie opens the list to answer.
 *
 * Every job lands in exactly ONE bucket, so the chip counts sum to the total
 * and no job shows up twice while you work through a pile.
 *
 * Precedence is money-first, matching the rule nextBestAction already
 * encodes: a payment waiting to be collected outranks everything else. A
 * booked job that's been invoiced and not paid is money owed, not a diary
 * entry.
 *
 * The one thing money does NOT outrank is a day still to come. Tradies who
 * take the cash up front are paid before the work exists, so `paid` on its
 * own can't mean "finished" — see isStillBooked.
 */

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';

/** Amounts within half a cent are settled. Mirrors derivePaymentState. */
const EPSILON = 0.005;

export type JobBucket = 'to_send' | 'waiting' | 'owed' | 'scheduled' | 'done';
export type JobFilterKey = 'all' | JobBucket;

export const JOB_FILTERS: { key: JobFilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'to_send', label: 'To send' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'owed', label: 'Owed' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'done', label: 'Done' },
];

export function isJobFilterKey(v: unknown): v is JobFilterKey {
  return typeof v === 'string' && JOB_FILTERS.some((f) => f.key === v);
}

/**
 * Index documents by the job they hang off.
 *
 * Lives here because bucketing needs it first, but the search index and the
 * sort metrics need the same map — and walking `documents` once per consumer,
 * per keystroke, was the cost this replaced.
 */
export function groupDocsByJob(documents: Document[]): Map<string, Document[]> {
  const byJob = new Map<string, Document[]>();
  for (const d of documents || []) {
    if (!d?.jobId) continue;
    const list = byJob.get(d.jobId);
    if (list) list.push(d);
    else byJob.set(d.jobId, [d]);
  }
  return byJob;
}

function isLive(doc: Document): boolean {
  return doc.stage !== 'cancelled';
}

/** Outstanding balance on an invoice — computed, since the stored
 *  `balanceDue` can be stale on older docs (same reason paidTransition
 *  derives it). */
function invoiceOwes(doc: Document): boolean {
  if (doc.type !== 'invoice' || !isLive(doc)) return false;
  const total = Number(doc.total) || 0;
  const paid = Number(doc.paidTotal) || 0;
  return total - paid > EPSILON;
}

/** Midnight today — the granularity a booking is judged at. */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Is the booking still ahead of the tradie?
 *
 * Day-granularity on purpose: a job booked for 9am today is still today's
 * work at 3pm, so the whole day counts as upcoming. Measured off the END of
 * a multi-day booking, since day three of a three-day job is still work.
 */
export function isStillBooked(job: Job, today: number = startOfToday()): boolean {
  const end = Number(job.scheduledEndDate) || Number(job.scheduledStartDate) || 0;
  return end > 0 && end >= today;
}

/**
 * @param today Midnight of the current day. Frozen by the caller for the
 *   session — a booking is a day-level idea, so re-ticking it per render
 *   would only make the buckets non-deterministic and the tests unwritable.
 */
export function bucketForJob(
  job: Job,
  docs: Document[],
  today: number = startOfToday(),
): JobBucket {
  const attached = (docs || []).filter(Boolean);

  // Parked or settled. Checked first so an archived job never reappears in
  // a working pile because of a stale doc hanging off it.
  if (job.archivedAt) return 'done';
  if (job.stage === 'closed' || job.stage === 'cancelled') return 'done';
  // `paid` normally ends the line — but it arrives early on a job the
  // customer paid up front, and filing next Tuesday's work under Done hid it
  // from the pile the tradie plans the week from, while its calendar event
  // carried on existing. Money in the bank doesn't finish the work.
  //
  // A job can also be left reading `paid` while an invoice still owes money:
  // correcting or removing a payment re-derives the document from its ledger,
  // and the Job stage only follows on the server's next cascade (see
  // deriveJobStageBump in functions/src/jobHandlers.ts). Filing that under
  // Done is what hid real money from the Owed pile, so an outstanding balance
  // wins here too — and keeps any job already stuck in that state visible
  // without waiting for a write to heal it.
  if (
    job.stage === 'paid' &&
    !isStillBooked(job, today) &&
    !attached.some(invoiceOwes)
  ) {
    return 'done';
  }

  // Money outranks everything below — this is the pile that costs you.
  if (attached.some(invoiceOwes)) return 'owed';

  // Work in hand. `completed` deliberately isn't here: a finished job with
  // nothing invoiced still needs something sent, so it falls through — and
  // a date that has already been and gone doesn't hold it in the diary.
  if (job.stage === 'scheduled' || job.stage === 'in_progress') return 'scheduled';
  if (isStillBooked(job, today)) return 'scheduled';

  // Sent and the ball is in the customer's court.
  if (attached.some((d) => isLive(d) && d.stage === 'quote_sent')) return 'waiting';

  // Everything else is your move: drafts never sent, and finished work
  // still waiting to be invoiced.
  return 'to_send';
}

/**
 * Test-only convenience. The screen deliberately does NOT use this: it
 * buckets every job once into a map and compares against that, so adding
 * a filter chip doesn't multiply into another pass over every document on
 * every keystroke.
 */
export function matchesJobFilter(
  job: Job,
  docs: Document[],
  filter: JobFilterKey,
  today?: number,
): boolean {
  if (filter === 'all') return true;
  return bucketForJob(job, docs, today) === filter;
}
