/**
 * applyJobStageChange — single entry point for Job-stage transitions made
 * via the JobStageSheet. Couples the underlying primary quote-doc to the
 * Job stage so downstream features (Push to Xero, "Continue Draft" banner,
 * etc.) don't see an out-of-sync doc.
 *
 * Without this, picking "Accepted" on the JobStageSheet only changes the
 * Job document while the linked legacy quote stays at status='draft' — Push
 * to Xero hides, the Dashboard "Continue Draft" banner keeps showing, and
 * the Xero auto-trigger never fires.
 */

import type { Job, JobStage } from '../../shared/job/types';
import type { Document } from '../types/document';
import { applyStageChange, type ApplyStageChangeHelpers } from './applyStageChange';

export interface ApplyJobStageChangeOptions {
  job: Job;
  target: JobStage;
  primaryDoc?: Document | null;
  saveJob: (job: Job) => Promise<void>;
  helpers: ApplyStageChangeHelpers;
}

const QUOTE_LIFECYCLE_STAGES = ['draft', 'quote_sent', 'quote_accepted'] as const;

/**
 * Map a Job stage to the matching Document stage on the quote side. Returns
 * null when there's nothing to propagate (e.g. for stages that only mean
 * something to the Job — `scheduled`, `in_progress`, `completed`).
 */
function quoteDocStageForJobStage(target: JobStage): Document['stage'] | null {
  switch (target) {
    case 'quoted':
      return 'quote_sent';
    case 'accepted':
      return 'quote_accepted';
    default:
      return null;
  }
}

export async function applyJobStageChange({
  job,
  target,
  primaryDoc,
  saveJob,
  helpers,
}: ApplyJobStageChangeOptions): Promise<void> {
  // Propagate to the primary quote-doc when the target maps to a quote stage
  // and the doc hasn't crossed into invoice territory yet. Skipping the
  // propagation post-conversion means a Job stage change on a paid invoice
  // job doesn't drag the invoice backward.
  if (primaryDoc && primaryDoc.type === 'quote') {
    const desiredDocStage = quoteDocStageForJobStage(target);
    const stillInQuoteLifecycle = (QUOTE_LIFECYCLE_STAGES as readonly string[]).includes(
      primaryDoc.stage,
    );
    if (
      desiredDocStage &&
      stillInQuoteLifecycle &&
      primaryDoc.stage !== desiredDocStage
    ) {
      await applyStageChange(primaryDoc, desiredDocStage, helpers);
    }
  }

  await saveJob({ ...job, stage: target });
}
