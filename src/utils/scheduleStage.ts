/**
 * What a Job's stage becomes when a date is written onto it or taken off.
 *
 * Picking a date IS how a tradie schedules a job, so the stage has to
 * follow the date. This used to promote only from `accepted` — the one
 * stage a job reaches by the customer accepting the quote in the app —
 * which meant the common path never moved: quote goes out, customer rings
 * up and books a day, tradie picks the day, and the pill still reads
 * "Quote Sent" on a job with next Tuesday sitting on it. The status the
 * tradie just set appeared nowhere, so scheduling read as broken.
 *
 * The jobs list already treats a dated job as scheduled (see bucketForJob,
 * which buckets on `scheduledStartDate` regardless of stage) — this makes
 * the stage agree with the pile the job is already in.
 */

import type { JobStage } from '../../shared/job/types';

/**
 * Stages that sit before `scheduled` on the ladder. A date moves these on;
 * everything later keeps its stage, because writing a date on work that's
 * already done doesn't un-finish it.
 */
const PRE_SCHEDULE_STAGES: ReadonlySet<JobStage> = new Set<JobStage>([
  'inquiry',
  'quoted',
  'accepted',
]);

export interface ScheduleStageOptions {
  /**
   * Set when the tradie answered "Move to Scheduled" on an in-progress job
   * being pushed into the future — they hadn't really started, so the job
   * drops back rather than keeping a start stamp it never earned.
   */
  demote?: boolean;
}

/** The stage a job lands in once a start date is saved onto it. */
export function stageAfterScheduling(
  current: JobStage,
  { demote }: ScheduleStageOptions = {},
): JobStage {
  if (demote && current === 'in_progress') return 'scheduled';
  return PRE_SCHEDULE_STAGES.has(current) ? 'scheduled' : current;
}

/**
 * The mirror rule: a scheduled job with no date is a contradiction, so
 * clearing the date drops it back to accepted. Later stages keep theirs —
 * a completed job doesn't reopen because someone tidied up its date.
 */
export function stageAfterClearingDate(current: JobStage): JobStage {
  return current === 'scheduled' ? 'accepted' : current;
}
