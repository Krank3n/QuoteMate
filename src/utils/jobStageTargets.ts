/**
 * Which stages a Job may legally move to next.
 *
 * Two surfaces now offer a status change — the timeline pill's
 * JobStageSheet and the kebab's "Change status" submenu — and they must
 * agree. Computing the list twice is how a job ends up offering a
 * transition on one surface that the other hides (and, once the shared
 * state machine moves, one of them starts offering an edge the server
 * rejects).
 *
 * Only legal edges are offered. The UI used to show every stage and let
 * the server reject illegal ones, which surfaced as a silent failure
 * after the tap.
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
}

export function legalStageTargets(
  current: JobStage,
  { depositPaid, excludeScheduled }: StageTargetOptions = {},
): JobStage[] {
  return ALL_STAGES.filter(
    (s) =>
      s !== current &&
      canTransition(current, s, { depositPaid }) &&
      !(excludeScheduled && s === 'scheduled'),
  );
}

/** Whether a dedicated "Schedule…" row should show for this job. */
export function shouldOfferSchedule(job: Pick<Job, 'stage'>): boolean {
  return !SCHEDULE_HIDDEN_STAGES.has(job.stage);
}
