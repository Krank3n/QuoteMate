/**
 * Activity timeline for a Job.
 *
 * Pure function that derives an ordered list of events from the Job, its
 * attached Documents (with their stage-transition timestamps), and the
 * payment ledger on each Document. No database reads — caller passes the
 * data already in-hand from the store.
 *
 * Events always sorted newest-first; unknown / undated events are
 * filtered out. A handful of events emit even when no explicit timestamp
 * exists (fallbacks: doc.createdAt for "Quote drafted", job.createdAt
 * for "Job created") so the timeline isn't empty on day-one.
 */

import type { Job, JobStage } from '../../shared/job/types';
import type { Document } from '../types/document';
import { formatScheduledDate, formatScheduledTime } from './formatSchedule';

export type TimelineEventKind =
  | 'job_created'
  | 'quote_drafted'
  | 'quote_sent'
  | 'quote_accepted'
  | 'quote_rejected'
  | 'invoice_created'
  | 'invoice_sent'
  | 'payment_deposit'
  | 'payment_balance'
  | 'payment_manual'
  | 'job_scheduled'
  | 'job_in_progress'
  | 'job_completed'
  | 'job_paid'
  | 'job_closed'
  | 'job_cancelled'
  | 'job_scheduled_upcoming';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  at: number;                  // ms epoch
  title: string;               // "Quote sent"
  detail?: string;              // "to Jones · $6,312"
  amount?: number;              // dollars (for payment events / quoted / invoiced)
  /** Future-dated. Renders differently (hourglass, dim). */
  upcoming?: boolean;
}

function fmtCurrency(n: number): string {
  if (!Number.isFinite(n)) return '';
  return '$' + Math.round(n).toLocaleString('en-AU');
}

function push(events: TimelineEvent[], e: TimelineEvent | null) {
  if (e) events.push(e);
}

/**
 * Compose the timeline.
 *
 * @param job   - the Job itself
 * @param docs  - every Document attached to this Job (caller filters)
 * @param now   - injectable "now" for testability; defaults to Date.now()
 */
export function deriveTimelineEvents(
  job: Job,
  docs: Document[],
  now: number = Date.now(),
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Job creation — always present.
  push(events, {
    id: `${job.id}:created`,
    kind: 'job_created',
    at: Number(job.createdAt) || 0,
    title: 'Job created',
    detail: job.customerName ? `for ${job.customerName}` : undefined,
  });

  // Per-document events.
  for (const doc of docs) {
    const docCustomer = doc.customerName || '';
    const docTotal = Number(doc.total) || 0;
    const originalDraft = Number(doc.createdAt) || 0;

    // Every doc starts as a quote draft — use createdAt as the fallback.
    push(events, {
      id: `${doc.id}:drafted`,
      kind: 'quote_drafted',
      at: originalDraft,
      title: 'Quote drafted',
      detail: doc.number ? `${doc.number}` : undefined,
      amount: docTotal,
    });

    // Quote sent — sentAt is the stamped transition; only emit if it post-
    // dates createdAt so the "drafted" + "sent" aren't identical.
    if (doc.sentAt && doc.sentAt > originalDraft && doc.type === 'quote') {
      push(events, {
        id: `${doc.id}:quote_sent`,
        kind: 'quote_sent',
        at: doc.sentAt,
        title: 'Quote sent',
        detail: docCustomer ? `to ${docCustomer}` : undefined,
        amount: docTotal,
      });
    }

    if (doc.acceptedAt) {
      push(events, {
        id: `${doc.id}:accepted`,
        kind: 'quote_accepted',
        at: doc.acceptedAt,
        title: 'Quote accepted',
        amount: docTotal,
      });
    }

    if (doc.stage === 'quote_rejected' && doc.respondedAt) {
      push(events, {
        id: `${doc.id}:rejected`,
        kind: 'quote_rejected',
        at: doc.respondedAt,
        title: 'Quote rejected',
      });
    }

    if (doc.invoicedAt) {
      push(events, {
        id: `${doc.id}:invoiced`,
        kind: 'invoice_created',
        at: doc.invoicedAt,
        title: 'Converted to invoice',
        detail: doc.number ? `${doc.number}` : undefined,
        amount: docTotal,
      });
    }

    // Invoice sent — distinct from the convert event when the tradie sends
    // some time after converting. Uses sentAt but only while the doc is
    // invoice-shaped.
    if (
      doc.sentAt &&
      doc.type === 'invoice' &&
      doc.invoicedAt &&
      doc.sentAt > doc.invoicedAt
    ) {
      push(events, {
        id: `${doc.id}:invoice_sent`,
        kind: 'invoice_sent',
        at: doc.sentAt,
        title: 'Invoice sent',
        detail: docCustomer ? `to ${docCustomer}` : undefined,
        amount: docTotal,
      });
    }

    // Payment ledger — one event per payment.
    for (const p of doc.payments || []) {
      const kind: TimelineEventKind =
        p.kind === 'deposit'
          ? 'payment_deposit'
          : p.kind === 'balance'
            ? 'payment_balance'
            : 'payment_manual';
      const title =
        p.kind === 'deposit'
          ? 'Deposit received'
          : p.kind === 'balance'
            ? 'Balance received'
            : 'Payment received';
      const detail =
        p.method === 'square'
          ? 'via Square'
          : p.method === 'bank'
            ? 'bank transfer'
            : p.method === 'cash'
              ? 'cash'
              : p.method
                ? p.method
                : undefined;
      push(events, {
        id: `${doc.id}:payment:${p.id}`,
        kind,
        at: Number(p.paidAt) || 0,
        title,
        detail,
        amount: Number(p.amount) || 0,
      });
    }

    if (doc.paidInFullAt) {
      push(events, {
        id: `${doc.id}:paid_in_full`,
        kind: 'job_paid',
        at: doc.paidInFullAt,
        title: 'Paid in full',
        amount: docTotal,
      });
    }
  }

  // Job-level stage transitions.
  if (job.scheduledAt) {
    push(events, {
      id: `${job.id}:scheduled`,
      kind: 'job_scheduled',
      at: job.scheduledAt,
      title: 'Scheduled',
    });
  }
  if (job.inProgressAt) {
    push(events, {
      id: `${job.id}:in_progress`,
      kind: 'job_in_progress',
      at: job.inProgressAt,
      title: 'Work started',
    });
  }
  if (job.completedAt || job.completedDate) {
    push(events, {
      id: `${job.id}:completed`,
      kind: 'job_completed',
      at: Number(job.completedAt ?? job.completedDate) || 0,
      title: 'Completed',
    });
  }
  if (job.paidAt && !docs.some((d) => d.paidInFullAt === job.paidAt)) {
    // Job-level "paid" — skip if identical to a doc-level paid-in-full.
    push(events, {
      id: `${job.id}:paid`,
      kind: 'job_paid',
      at: job.paidAt,
      title: 'Marked as paid',
    });
  }
  if (job.closedAt) {
    push(events, {
      id: `${job.id}:closed`,
      kind: 'job_closed',
      at: job.closedAt,
      title: 'Archived',
    });
  }
  if (job.cancelledAt) {
    push(events, {
      id: `${job.id}:cancelled`,
      kind: 'job_cancelled',
      at: job.cancelledAt,
      title: 'Cancelled',
    });
  }

  // Upcoming: show scheduled start date as a preview row if it's in the
  // future and we haven't already passed "in progress".
  if (
    job.scheduledStartDate &&
    job.scheduledStartDate > now &&
    !job.inProgressAt &&
    !job.completedAt &&
    !job.completedDate &&
    !job.cancelledAt
  ) {
    push(events, {
      id: `${job.id}:scheduled_upcoming`,
      kind: 'job_scheduled_upcoming',
      at: job.scheduledStartDate,
      title: 'Scheduled to start',
      upcoming: true,
    });
  }

  // Sort newest first. Undated events (at === 0) drop to the bottom.
  events.sort((a, b) => (b.at || 0) - (a.at || 0));
  // Drop items without a timestamp entirely — they'd just be noise.
  return events.filter((e) => e.at > 0);
}

/** Friendly summary for a timeline event's amount field. */
export function formatEventAmount(amount?: number): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return '';
  return fmtCurrency(amount);
}

/**
 * The 5 slots a Job's lifecycle gets bucketed into for the on-card
 * timeline pill. Each slot can render multiple sub-statuses (e.g. the
 * "quote" slot covers Draft → Quote → Quote Sent) which getJobSubStatus
 * picks between based on the current stage and primary doc.
 */
export type JobSubStatusSlot =
  | 'quote'
  | 'accepted'
  | 'scheduled'
  | 'in_progress'
  | 'paid';

export interface JobSubStatus {
  slot: JobSubStatusSlot;
  label: string;
  icon: string;
}

/**
 * Compute the live label + icon for the active timeline pill. Pulls
 * cues from the job stage, the primary doc's stage (sent / accepted /
 * invoice_sent / partial), the deposit ledger, and the scheduled
 * start datetime so the pill reads "Quote Sent" / "Deposit Paid" /
 * "Wed 23 Apr · 9am" rather than just the bare stage name.
 *
 * Returns a default for terminal stages (closed/cancelled) — callers
 * should hide the timeline in those cases anyway.
 */
export function getJobSubStatus(
  job: Job,
  primaryDoc?: Document | null,
): JobSubStatus {
  const stage = job.stage;
  const docStage = primaryDoc?.stage;
  const depositPaid =
    Number(primaryDoc?.depositPaid) > 0 ||
    (primaryDoc?.payments || []).some((p) => p.kind === 'deposit');

  if (stage === 'inquiry') {
    return { slot: 'quote', label: 'Draft', icon: 'file-document-edit-outline' };
  }
  if (stage === 'quoted') {
    if (docStage === 'quote_sent' || docStage === 'quote_accepted') {
      return { slot: 'quote', label: 'Quote Sent', icon: 'send' };
    }
    return { slot: 'quote', label: 'Quote', icon: 'file-send-outline' };
  }
  if (stage === 'accepted') {
    if (depositPaid) {
      return { slot: 'accepted', label: 'Deposit Paid', icon: 'cash-check' };
    }
    return { slot: 'accepted', label: 'Accepted', icon: 'handshake-outline' };
  }
  if (stage === 'scheduled') {
    const ms = job.scheduledStartDate;
    const date = formatScheduledDate(ms);
    const time = formatScheduledTime(ms);
    if (date && time) {
      // "9:00 am" → "9am" so the pill stays compact on small screens.
      const compactTime = time.replace(/^(\d+):00\s/, '$1');
      return { slot: 'scheduled', label: `${date} · ${compactTime}`, icon: 'calendar-clock' };
    }
    if (date) {
      return { slot: 'scheduled', label: date, icon: 'calendar-check-outline' };
    }
    return { slot: 'scheduled', label: 'Scheduled', icon: 'calendar-check-outline' };
  }
  if (stage === 'in_progress') {
    if (docStage === 'invoice_sent' || docStage === 'partially_paid') {
      return { slot: 'in_progress', label: 'Invoice Sent', icon: 'send' };
    }
    return { slot: 'in_progress', label: 'In Progress', icon: 'hammer-wrench' };
  }
  if (stage === 'completed') {
    return { slot: 'paid', label: 'Completed', icon: 'flag-checkered' };
  }
  if (stage === 'paid') {
    return { slot: 'paid', label: 'Paid', icon: 'check-decagram-outline' };
  }

  return { slot: 'quote', label: 'Draft', icon: 'file-document-edit-outline' };
}

/** Ordinal of the earliest job stage that fills each slot's micro-dot. */
const SLOT_MIN_STAGE_ORDINAL: Record<JobSubStatusSlot, number> = {
  quote: 1,         // STAGE_ORDER['quoted']
  accepted: 2,      // STAGE_ORDER['accepted']
  scheduled: 3,     // STAGE_ORDER['scheduled']
  in_progress: 4,   // STAGE_ORDER['in_progress']
  paid: 6,          // STAGE_ORDER['paid']
};

const STAGE_ORDINAL: Record<JobStage, number> = {
  inquiry: 0,
  quoted: 1,
  accepted: 2,
  scheduled: 3,
  in_progress: 4,
  completed: 5,
  paid: 6,
  closed: 7,
  cancelled: -1,
};

/** Write-once stamps line up with slots so a stage-leap still lights the dot. */
const SLOT_STAMP: Record<JobSubStatusSlot, keyof Job> = {
  quote: 'quotedAt',
  accepted: 'acceptedAt',
  scheduled: 'scheduledAt',
  in_progress: 'inProgressAt',
  paid: 'paidAt',
};

export function isSlotReached(job: Job, slot: JobSubStatusSlot): boolean {
  if (job[SLOT_STAMP[slot]]) return true;
  return STAGE_ORDINAL[job.stage] >= SLOT_MIN_STAGE_ORDINAL[slot];
}

/**
 * The write-once stamp that dates each stage — "Quote sent" reads
 * `quotedAt`, "Paid" reads `paidAt`, and so on. `inquiry` has no stamp of
 * its own; a freshly created job is dated by the fallback chain below.
 */
const STAGE_TIMESTAMP_KEY: Record<JobStage, keyof Job | null> = {
  inquiry: null,
  quoted: 'quotedAt',
  accepted: 'acceptedAt',
  scheduled: 'scheduledAt',
  in_progress: 'inProgressAt',
  completed: 'completedAt',
  paid: 'paidAt',
  closed: 'closedAt',
  cancelled: 'cancelledAt',
};

/**
 * The timestamp the Jobs list actually PRINTS on a card ("Quote sent 6
 * days ago"). Both JobCard and the list's sort read it from here.
 *
 * They have to agree. The list used to inherit Firestore's
 * `orderBy('updatedAt','desc')` while each card was labelled with its
 * stage stamp — so a row saying "Quote sent 6 days ago" could sit above
 * one saying "Created 11 days ago" purely because a background write had
 * touched `updatedAt`. The ordering rule was invisible on screen, which
 * reads as no ordering at all.
 */
export function jobStatusTimestamp(job: Job): number {
  const key = STAGE_TIMESTAMP_KEY[job.stage];
  const stamped = key ? (job[key] as number | undefined) : undefined;
  return Number(stamped) || Number(job.updatedAt) || Number(job.createdAt) || 0;
}

/**
 * Newest-first by the date the card shows. Ties break on `updatedAt` then
 * `id` so the order is total — an unstable tail would let rows swap places
 * between renders, which looks like the list reshuffling on its own.
 *
 * Returns a new array; never sorts the caller's (the store's) in place.
 */
export function sortJobsForList<T extends Job>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const byStatus = jobStatusTimestamp(b) - jobStatusTimestamp(a);
    if (byStatus !== 0) return byStatus;
    const byUpdated = (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    if (byUpdated !== 0) return byUpdated;
    return String(a.id).localeCompare(String(b.id));
  });
}
