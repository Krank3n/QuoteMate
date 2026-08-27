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
import { clientNoteDetail } from './customerNote';

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
      // Why they said no. The acceptance page asks for it and the server
      // stores it, but until now the only place it was ever shown was the
      // notification email — so the tradie who read it on their phone at
      // 7pm had no way back to it.
      push(events, {
        id: `${doc.id}:rejected`,
        kind: 'quote_rejected',
        at: doc.respondedAt,
        title: 'Quote rejected',
        detail: clientNoteDetail(doc.clientNotes),
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
  // Archiving writes different fields depending on which affordance was used:
  // the kebab's Archive parks the job with `archivedAt` alone and leaves the
  // stage untouched, while the stage sheet and closeJob move it to `closed`
  // (server-stamped `closedAt`). Reading only `closedAt` meant a kebab-archived
  // job showed nothing at all in its history — and since bucketFor() checks
  // `archivedAt` first, it had silently dropped into Done with its old stage
  // pill still showing. Take whichever stamp exists, oldest first.
  const archivedStamp =
    job.closedAt && job.archivedAt
      ? Math.min(job.closedAt, job.archivedAt)
      : job.closedAt ?? job.archivedAt;
  if (archivedStamp) {
    push(events, {
      id: `${job.id}:closed`,
      kind: 'job_closed',
      at: archivedStamp,
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
 *
 * The rail measures WORK, so it ends at `completed`. `paid` used to own
 * that last slot with `completed` squatting in it, which meant marking a
 * job paid slid the pill to the end of the job — a claim about the work
 * that money isn't entitled to make, and flatly wrong on the jobs tradies
 * get paid for up front. Money has its own pill: see PaymentChip.
 */
export type JobSubStatusSlot =
  | 'quote'
  | 'accepted'
  | 'scheduled'
  | 'in_progress'
  | 'completed';

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
/**
 * Wording for a primary doc that has become an invoice.
 *
 * The quote-flavoured labels below ("Quote", "Quote Sent") are chosen off
 * the JOB stage, which can sit at `quoted` long after the document became
 * an invoice — a converted invoice is deliberately left at stage `draft`
 * so the tradie still has to press Send, and deriveJobStageBump has no
 * rule for `draft`, so nothing drags the job forward. The card then reads
 * "Quote" on something that is demonstrably an invoice, and the tradie
 * goes hunting for a Convert to Invoice row that is correctly hidden.
 *
 * Returns null for quotes, leaving the job-stage wording untouched.
 */
/** An invoice that still counts — cancelled ones are history, not state. */
export function isLiveInvoice(doc?: Document | null): boolean {
  return !!doc && doc.type === 'invoice' && doc.stage !== 'cancelled';
}

export function invoiceWording(doc?: Document | null): Pick<JobSubStatus, 'label' | 'icon'> | null {
  if (!doc || !isLiveInvoice(doc)) return null;
  // Workflow words only. This deliberately says nothing about money —
  // PaymentChip owns that axis, and it sits on the same card. An earlier
  // version returned "Paid" / "Part Paid" here, so a settled invoice read
  // "Paid" on the rail AND "Paid" on the chip, two feet apart. See the
  // header of PaymentChip: "Splits the status UI in two: the stage chip
  // (workflow) and this chip (money). Independent axes."
  if (doc.stage === 'draft') {
    // Converted but not yet sent.
    return { label: 'Invoice', icon: 'receipt' };
  }
  return { label: 'Invoice Sent', icon: 'send' };
}

/**
 * True when the document has moved on but the Job stage hasn't caught up —
 * the job still reads as a quote while its document is already an invoice.
 *
 * Three surfaces have to ask this (the card's rail, the card's meta line,
 * and the kebab's "Currently …" subtitle) and each phrases the answer
 * differently, so they share the question rather than the wording. Writing
 * the condition out three times is how one of them keeps saying "Quoted"
 * after the other two are fixed.
 */
export function documentHasOutrunJobStage(
  job: Pick<Job, 'stage'>,
  primaryDoc?: Document | null,
): boolean {
  if (job.stage !== 'inquiry' && job.stage !== 'quoted') return false;
  return !!invoiceWording(primaryDoc);
}

const COMPLETED_STATUS: JobSubStatus = {
  slot: 'completed',
  label: 'Completed',
  icon: 'flag-checkered',
};

/** The booking, worded for the pill: "Wed 23 Apr · 9am". */
function scheduledStatus(job: Job): JobSubStatus {
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

/**
 * Where a PAID job's work actually got to.
 *
 * `paid` is a fact about money, and the money can land at any point in the
 * job — plenty of tradies take the lot up front, so the stage arrives while
 * the work is still a date in the diary. The rail therefore reads the
 * write-once stage stamps, which record where the work genuinely reached,
 * and leaves the money to PaymentChip.
 *
 * Walked from the far end of the ladder back, so the furthest point the job
 * ever reached is the one that shows.
 */
function workflowStatusOfPaidJob(job: Job): JobSubStatus {
  if (job.completedAt || job.completedDate) return COMPLETED_STATUS;
  if (job.inProgressAt) return { slot: 'in_progress', label: 'In Progress', icon: 'hammer-wrench' };
  if (job.scheduledStartDate || job.scheduledAt) return scheduledStatus(job);
  // Nothing but money: a job paid straight off the quote, with no work
  // stamps at all. Acceptance is the one thing the payment does prove —
  // the customer said yes — so the rail stops there rather than guessing.
  return { slot: 'accepted', label: 'Accepted', icon: 'handshake-outline' };
}

export function getJobSubStatus(
  job: Job,
  primaryDoc?: Document | null,
): JobSubStatus {
  const stage = job.stage;
  const docStage = primaryDoc?.stage;
  const depositPaid =
    Number(primaryDoc?.depositPaid) > 0 ||
    (primaryDoc?.payments || []).some((p) => p.kind === 'deposit');

  // Slot stays keyed to the job stage so the rail's geometry is unchanged —
  // only the wording defers to the document.
  const asInvoice = invoiceWording(primaryDoc);

  if (stage === 'inquiry') {
    if (asInvoice) return { slot: 'quote', ...asInvoice };
    return { slot: 'quote', label: 'Draft', icon: 'file-document-edit-outline' };
  }
  if (stage === 'quoted') {
    if (asInvoice) return { slot: 'quote', ...asInvoice };
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
    return scheduledStatus(job);
  }
  if (stage === 'in_progress') {
    if (docStage === 'invoice_sent' || docStage === 'partially_paid') {
      return { slot: 'in_progress', label: 'Invoice Sent', icon: 'send' };
    }
    return { slot: 'in_progress', label: 'In Progress', icon: 'hammer-wrench' };
  }
  if (stage === 'completed') {
    return COMPLETED_STATUS;
  }
  if (stage === 'paid') {
    return workflowStatusOfPaidJob(job);
  }

  if (asInvoice) return { slot: 'quote', ...asInvoice };
  return { slot: 'quote', label: 'Draft', icon: 'file-document-edit-outline' };
}

/** Ordinal of the earliest job stage that fills each slot's micro-dot. */
const SLOT_MIN_STAGE_ORDINAL: Record<JobSubStatusSlot, number> = {
  quote: 1,         // STAGE_ORDER['quoted']
  accepted: 2,      // STAGE_ORDER['accepted']
  scheduled: 3,     // STAGE_ORDER['scheduled']
  in_progress: 4,   // STAGE_ORDER['in_progress']
  completed: 5,     // STAGE_ORDER['completed']
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
  completed: 'completedAt',
};

/** Did the WORK finish? Money is silent on the question. */
export function jobWorkIsDone(job: Pick<Job, 'stage' | 'completedAt' | 'completedDate'>): boolean {
  return !!job.completedAt || !!job.completedDate || job.stage === 'completed';
}

/**
 * How far along the WORK the job is, for lighting dots.
 *
 * `paid` sits above `in_progress` and `completed` on the stage ladder, so
 * taking its ordinal at face value lit every work dot on a job that hasn't
 * started — the pill would sit on next Tuesday's booking with the dot after
 * it already green. Money doesn't advance the work, so a paid job is
 * measured by where its pill genuinely landed instead.
 */
function workflowOrdinal(job: Job): number {
  if (job.stage !== 'paid') return STAGE_ORDINAL[job.stage];
  return SLOT_MIN_STAGE_ORDINAL[workflowStatusOfPaidJob(job).slot];
}

export function isSlotReached(job: Job, slot: JobSubStatusSlot): boolean {
  // Stamps still speak for themselves, so a stage-leap lights what it skipped.
  if (job[SLOT_STAMP[slot]]) return true;
  // The finish line needs evidence the work finished — never an ordinal.
  if (slot === 'completed') return jobWorkIsDone(job);
  return workflowOrdinal(job) >= SLOT_MIN_STAGE_ORDINAL[slot];
}

/**
 * The write-once stamp that dates each stage — "Quote sent" reads
 * `quotedAt`, "Paid" reads `paidAt`, and so on.
 *
 * `inquiry` has no stage stamp, and used to fall through to `updatedAt`. But
 * the card labels that stage "Created", so any later write to the job made it
 * claim it was created just now — a two-month-old draft reading "Created less
 * than a minute ago" after its customer's phone number was edited, and jumping
 * to the top of the Recent sort with it. `createdAt` is the field that actually
 * means what the label says.
 */
const STAGE_TIMESTAMP_KEY: Record<JobStage, keyof Job | null> = {
  inquiry: 'createdAt',
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

/** Chip wording per stage. Colour-free, so jobStatusLabel can reach it
 *  without a theme — jobStageMetaFor builds its chipLabels from this. */
export const STAGE_CHIP_LABELS: Record<JobStage, string> = {
  inquiry: 'Inquiry',
  quoted: 'Quoted',
  accepted: 'Accepted',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  paid: 'Paid',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/**
 * What the app currently calls this job's status — the same words the
 * card's timeline pill prints.
 *
 * Both status doors print this under "Currently …", and the pill door
 * prints it a centimetre below the pill you just tapped. Naming the raw
 * job stage there made them disagree out loud: a job at `in_progress`
 * under a sent invoice shows "Invoice Sent" on the pill, and the sheet it
 * opened answered "Currently In Progress".
 *
 * Three places the pill isn't printing a status word, where the sentence
 * form is the honest answer:
 * - terminal jobs have no pill at all (the card shows a stage chip), and
 *   getJobSubStatus falls through to "Draft" for them, which is a lie.
 * - a scheduled job's pill prints the date ("Fri 5 Sep · 9am"), and
 *   "Currently Fri 5 Sep · 9am" is not a sentence.
 * - the pill marks "a quote/invoice exists" with the bare noun, so the
 *   past participle is the same status read aloud (see STATUS_WORD).
 */
export function jobStatusLabel(job: Job, primaryDoc?: Document | null): string {
  if (job.stage === 'cancelled' || job.stage === 'closed') {
    return STAGE_CHIP_LABELS[job.stage];
  }
  const sub = getJobSubStatus(job, primaryDoc);
  if (sub.slot === 'scheduled') return STAGE_CHIP_LABELS.scheduled;
  return STATUS_WORD[sub.label] ?? sub.label;
}

/**
 * Pill step marker → the word for it in a sentence. Only the bare nouns
 * need this: "Currently Quote" reads as a typo, "Currently Quote Sent"
 * doesn't. Same status either way — this is tense, not a different answer.
 */
const STATUS_WORD: Record<string, string> = {
  Quote: 'Quoted',
  Invoice: 'Invoiced',
};

