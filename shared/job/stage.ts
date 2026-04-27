import type { JobStage, Job, JobDocument } from './types';

// Legal stage transitions. Enforced in the UI (stage sheet filters targets)
// AND in the save path (server-side guard to land later). Terminal states
// (cancelled, closed) expose a reactivation / unarchive path respectively
// so tradies aren't trapped when life doesn't match the happy path.
//
// The one context-sensitive rule: `accepted → quoted` is only legal when
// the quote is "soft" accepted — i.e. no deposit has been paid yet. Once
// money has moved, the money firewall holds: can't revert back across
// the accept line without explicitly cancelling first. That rule is
// expressed in canTransition's `ctx.depositPaid` flag rather than the
// static graph, since it depends on the primary document's state.
export const JOB_STAGE_TRANSITIONS: Record<JobStage, JobStage[]> = {
  inquiry:     ['quoted', 'cancelled'],
  quoted:      ['accepted', 'inquiry', 'cancelled'],
  // 'quoted' included here but gated by ctx.depositPaid in canTransition.
  accepted:    ['scheduled', 'in_progress', 'quoted', 'cancelled'],
  scheduled:   ['in_progress', 'accepted', 'cancelled'],
  in_progress: ['completed', 'scheduled', 'cancelled'],
  completed:   ['paid', 'in_progress', 'cancelled'],
  paid:        ['closed'],
  closed:      ['paid'],       // unarchive
  cancelled:   ['inquiry'],    // reactivate
};

export interface TransitionContext {
  /** True when money has moved through the primary doc's deposit. Blocks
   *  `accepted → quoted` (once the customer's paid a deposit, the contract
   *  is alive; reverting requires an explicit cancel first). */
  depositPaid?: boolean;
}

export function canTransition(
  from: JobStage,
  to: JobStage,
  ctx: TransitionContext = {},
): boolean {
  if (from === to) return true;
  const legal = JOB_STAGE_TRANSITIONS[from] ?? [];
  if (!legal.includes(to)) return false;
  // Money firewall: once deposit has been paid, accepted can't drop back
  // to quoted. Everything else within the execution lane is still open.
  if (from === 'accepted' && to === 'quoted' && ctx.depositPaid) {
    return false;
  }
  return true;
}

export function assertTransition(
  from: JobStage,
  to: JobStage,
  ctx: TransitionContext = {},
): void {
  if (!canTransition(from, to, ctx)) {
    throw new Error(`Illegal job stage transition: ${from} → ${to}`);
  }
}

/**
 * Returns true when the transition crosses a "contract" line — i.e.
 * reverses movement such that the primary doc's stage should be adjusted
 * in lockstep. The UI uses this to decide whether to prompt the user
 * before flipping.
 */
export function crossesContractLine(from: JobStage, to: JobStage): boolean {
  // Going backwards across acceptance: doc flips quote_accepted → quote_sent.
  if (from === 'accepted' && to === 'quoted') return true;
  // Reactivating a cancelled job: doc was cancelled, put it back to draft.
  if (from === 'cancelled' && to === 'inquiry') return true;
  return false;
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

/**
 * Small helper: read the soft/hard accepted flag straight off a Job +
 * its primary doc. Used by the stage sheet and the save path.
 */
export function depositHasBeenPaid(doc: {
  depositPaid?: number;
  depositAmount?: number;
} | null | undefined): boolean {
  if (!doc) return false;
  return (doc.depositPaid ?? 0) > 0;
}

// Re-export Job type alongside so server-side callers have a single
// import to reach for when they enforce transitions during save.
export type { Job, JobStage };
