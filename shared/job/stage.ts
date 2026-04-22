import type { JobStage, JobDocument } from './types';

// Legal forward transitions. Tradies don't always go in order — the UI lets
// them jump freely — but the server enforces this set so we never corrupt
// aggregates or end up in a terminal loop. Cancelled/closed are terminal.
export const JOB_STAGE_TRANSITIONS: Record<JobStage, JobStage[]> = {
  inquiry:     ['quoted', 'cancelled'],
  quoted:      ['accepted', 'cancelled', 'inquiry'],
  accepted:    ['scheduled', 'in_progress', 'cancelled'],
  scheduled:   ['in_progress', 'accepted', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   ['paid', 'cancelled'],
  paid:        ['closed'],
  closed:      [],
  cancelled:   [],
};

export function canTransition(from: JobStage, to: JobStage): boolean {
  if (from === to) return true; // no-op
  return JOB_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: JobStage, to: JobStage): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal job stage transition: ${from} → ${to}`);
  }
}

// Backfill-only: derive a starting JobStage from the set of DocumentStages
// attached to a group of unified documents. Live updates use the explicit
// state machine, not this. Precedence goes from most-advanced (paid) down
// to least (inquiry) — first match wins.
export function deriveJobStageFromDocs(docs: JobDocument[]): JobStage {
  if (docs.length === 0) return 'inquiry';

  const active = docs.filter((d) => d.stage !== 'cancelled');
  if (active.length === 0) return 'cancelled';

  const stages = new Set(active.map((d) => d.stage));
  const allPaid = active.every((d) => d.stage === 'paid');

  if (allPaid) return 'paid';
  if (stages.has('partially_paid') || stages.has('invoice_sent')) return 'in_progress';
  if (stages.has('quote_accepted')) return 'accepted';
  if (stages.has('quote_rejected')) {
    // Rejected-only → treat as inquiry so the tradie can re-pitch. If there's
    // also a sent quote (re-pitch in flight), that wins via the next branch.
    if (!stages.has('quote_sent')) return 'inquiry';
  }
  if (stages.has('quote_sent')) return 'quoted';
  return 'inquiry';
}
