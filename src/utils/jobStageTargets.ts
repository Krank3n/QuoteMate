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
   * True when the caller renders its own "Schedule…" row. `scheduled` is
   * then dropped from the plain list so the action doesn't appear twice —
   * scheduling isn't a bare stage flip, it writes a date and lets the save
   * path bump the stage.
   */
  excludeScheduled?: boolean;
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
  { depositPaid, excludeScheduled, documentIsInvoice }: StageTargetOptions = {},
): JobStage[] {
  return ALL_STAGES.filter(
    (s) =>
      s !== current &&
      !isFirewalled(current, s, depositPaid) &&
      !(excludeScheduled && s === 'scheduled') &&
      !(documentIsInvoice && QUOTE_PHASE_STAGES.has(s)),
  );
}

/** Whether a dedicated "Schedule…" row should show for this job. */
export function shouldOfferSchedule(job: Pick<Job, 'stage'>): boolean {
  return !SCHEDULE_HIDDEN_STAGES.has(job.stage);
}
