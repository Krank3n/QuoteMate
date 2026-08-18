/**
 * Which stages a Job can be moved to.
 *
 * Two surfaces offer a status change — the timeline pill's JobStageSheet
 * and the kebab's "Change status" submenu — and they must agree.
 * Computing the list twice is how a job ends up offering a transition on
 * one surface that the other hides.
 *
 * **Leaps are allowed.** This used to show only the adjacent edges of the
 * state machine, which meant a tradie who did the work and got paid
 * without touching the app had to tap through quoted → accepted →
 * in_progress → completed → paid, reopening the sheet each time. Nothing
 * enforces the Job graph anyway: `assertTransition` is never called,
 * firestore.rules has no stage checks, and the only server trigger on the
 * jobs collection is calendar sync. (The *document* machine IS enforced
 * server-side, in documentHandlers — that's the one whose taps used to
 * fail silently, and it is not this one.) The rail already copes with
 * skipped stages: isSlotReached falls back to a stage-ordinal compare
 * "so a stage-leap still lights the dot".
 *
 * The money firewall still holds — see isFirewalled.
 */

import type { Job, JobStage } from '../../shared/job/types';
import { canTransition } from '../../shared/job/stage';

const ALL_STAGES: readonly JobStage[] = [
  'inquiry',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'paid',
  'closed',
  'cancelled',
];

/** Stages where penciling in a date makes no sense — the work is done or the job is dead. */
const SCHEDULE_HIDDEN_STAGES: ReadonlySet<JobStage> = new Set([
  'completed',
  'paid',
  'closed',
  'cancelled',
]);

export interface StageTargetOptions {
  /** Gates `accepted → quoted` in the shared state machine. */
  depositPaid?: boolean;
  /**
   * True when the primary document is already a live invoice. The
   * quote-side stages come off the list: offering "Mark as Quoted" on a
   * job you just invoiced contradicts the document sitting under it, and
   * taking it wouldn't touch the invoice anyway — applyJobStageChange only
   * propagates onto docs still in the quote lifecycle. The way back is
   * "Back to a quote…", which reverts the document too, and it re-opens
   * these stages by itself once the doc is a quote again.
   */
  documentIsInvoice?: boolean;
}

/** Stages that describe the quoting phase, before anything was invoiced. */
const QUOTE_PHASE_STAGES: ReadonlySet<JobStage> = new Set<JobStage>(['inquiry', 'quoted']);

/**
 * The one rule that still blocks a leap: once a deposit has been paid, an
 * accepted job can't drop back to quoted without an explicit cancel.
 *
 * Derived from `canTransition` rather than restated here, so
 * shared/job/stage.ts stays the single source of truth for the firewall —
 * an edge the static graph allows but the context-aware call rejects is,
 * by definition, the firewall talking.
 */
function isFirewalled(from: JobStage, to: JobStage, depositPaid?: boolean): boolean {
  return (
    canTransition(from, to, { depositPaid: false }) &&
    !canTransition(from, to, { depositPaid })
  );
}

export function legalStageTargets(
  current: JobStage,
  { depositPaid, documentIsInvoice }: StageTargetOptions = {},
): JobStage[] {
  return ALL_STAGES.filter(
    (s) =>
      s !== current &&
      !isFirewalled(current, s, depositPaid) &&
      !(documentIsInvoice && QUOTE_PHASE_STAGES.has(s)),
  );
}

/**
 * Whether picking `scheduled` should open the date picker rather than flip
 * the stage on its own. Scheduling isn't a bare stage flip — the picker
 * writes the date and the save path bumps the stage (stageAfterScheduling)
 * — but on a job whose work is done or dead, penciling in a date makes no
 * sense, so those stages fall back to the plain flip.
 *
 * A date already on the job is the exception: it can always be moved or
 * cleared. A job the customer paid up front is `paid` with next Tuesday
 * still on it, and hiding the picker left the only door to that booking
 * closed — the date couldn't be changed, and clearing it (which is what
 * takes the calendar event down) was impossible without dropping the stage
 * back first.
 */
export function shouldOfferSchedule(
  job: Pick<Job, 'stage' | 'scheduledStartDate'>,
): boolean {
  if (job.scheduledStartDate) return true;
  return !SCHEDULE_HIDDEN_STAGES.has(job.stage);
}

/**
 * Whether the sheet has to carry its own "Reschedule…" row.
 *
 * Normally the date door IS the ladder's `scheduled` row (see the
 * `opensPicker` handling in JobStageSheet / JobActionsSheet). Two jobs can't
 * use that door: one already standing on `scheduled`, because the ladder
 * never offers the stage you're on, and one past the schedule stages with a
 * booking still on it, where the row goes on meaning "move this job back to
 * Scheduled" and relabelling it as a date change would be a lie. Both get an
 * explicit row instead.
 */
export function shouldOfferReschedule(
  job: Pick<Job, 'stage' | 'scheduledStartDate'>,
): boolean {
  if (!shouldOfferSchedule(job)) return false;
  // Standing on `scheduled`, this is the only door there is — including on
  // a job a bare stage flip left marked Scheduled with no date at all.
  if (job.stage === 'scheduled') return true;
  return !!job.scheduledStartDate && SCHEDULE_HIDDEN_STAGES.has(job.stage);
}
