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

export function bucketForJob(job: Job, docs: Document[]): JobBucket {
  const attached = (docs || []).filter(Boolean);

  // Parked or settled. Checked first so an archived job never reappears in
  // a working pile because of a stale doc hanging off it.
  if (job.archivedAt) return 'done';
  if (job.stage === 'closed' || job.stage === 'cancelled' || job.stage === 'paid') {
    return 'done';
  }

  // Money outranks everything below — this is the pile that costs you.
  if (attached.some(invoiceOwes)) return 'owed';

  // Work in hand. `completed` deliberately isn't here: a finished job with
  // nothing invoiced still needs something sent, so it falls through.
  if (job.stage === 'scheduled' || job.stage === 'in_progress') return 'scheduled';
  if (job.scheduledStartDate) return 'scheduled';

  // Sent and the ball is in the customer's court.
  if (attached.some((d) => isLive(d) && d.stage === 'quote_sent')) return 'waiting';

  // Everything else is your move: drafts never sent, and finished work
  // still waiting to be invoiced.
  return 'to_send';
}

export function matchesJobFilter(
  job: Job,
  docs: Document[],
  filter: JobFilterKey,
): boolean {
  if (filter === 'all') return true;
  return bucketForJob(job, docs) === filter;
}
