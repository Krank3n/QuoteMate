// Time entry — hours actually worked on a Job.
//
// Stored at users/{uid}/timeEntries/{entryId}, linked to a Job via `jobId`.
// A quote's labour is an ESTIMATE; these are what really happened, so the
// invoice can bill real hours and the tradie can see which jobs ran over.
//
// The owner logs their own time and their crew's; crew can also send theirs
// in through a private link (functions/src/crewTime.ts), which lands as
// 'pending' until the owner approves it. shared/ is symlinked into
// functions/src/shared so this same file serves client and server.

export type TimeEntrySource = 'manual' | 'mate' | 'crew_link';

/**
 * 'pending' = sent in by a crew member through their link and not yet
 * approved by the owner. Pending time is shown on the job but counts toward
 * nothing — no totals, no invoices, no timesheet — until it's approved.
 * Absent means approved (everything the owner logs themselves).
 */
export type TimeEntryStatus = 'pending' | 'approved';

/** workerId prefix for time worked by a crew member rather than the owner. */
export const CREW_WORKER_PREFIX = 'crew:';

/**
 * Someone who works for the business. Kept on the business settings; there
 * are no logins — the owner logs time for them, or they send it in through
 * their own link, which the owner approves.
 */
export interface CrewMember {
  id: string;
  name: string;
  /** Where their hours link is emailed. Optional — without it the owner shares the link by text. */
  email?: string;
  /** What this person costs the business per hour — for costing, never shown to customers. */
  costRate?: number;
  /**
   * Invoices the business for their time (has an ABN). No super or on-costs
   * on top of their rate — it's already the whole cost.
   */
  contractor?: boolean;
  /** Removed from the list; past time keeps their name. */
  archived?: boolean;
  /** Present while the member has a live link (the token; the server stores only its hash). */
  linkToken?: string;
  linkIssuedAt?: number;
  createdAt: number;
}

export interface TimeEntry {
  id: string;
  /** The business account the entry belongs to (the collection's owner). */
  userId: string;
  jobId: string;
  /** The job's primary document when the time was logged, if it had one. */
  documentId?: string;
  /** Local calendar day worked, YYYY-MM-DD. */
  date: string;
  /** Canonical HOURS, like every other labour figure (labourUnits.ts). */
  hours: number;
  /** Optional "07:00" / "15:30" — when present, `hours` was derived from them. */
  startTime?: string;
  endTime?: string;
  note?: string;
  /** Who worked it: the owner's uid, or `crew:<crewMemberId>`. */
  workerId: string;
  workerName?: string;
  /** Set for time sent in through a crew link until the owner approves it. */
  status?: TimeEntryStatus;
  /** Non-billable time (a warranty callback, a quote visit) is logged but never invoiced. */
  billable: boolean;
  /**
   * What an hour of this cost the business when it started counting (logged
   * by the owner, or approved): the person's rate and super + on-costs as a
   * fraction. Kept so a later pay rise doesn't re-cost finished jobs. Never
   * shown to customers. See shared/time/labourCost.ts.
   */
  cost?: { rate: number; loading: number };
  source: TimeEntrySource;
  createdAt: number;
  updatedAt: number;
}
