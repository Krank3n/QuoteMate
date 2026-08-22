// Plan gates shared by the store's apply paths. The wizard paywalls the
// materials + pricing pipeline for free (post-trial) users on
// MaterialsListScreen; Mate's Apply path runs the same pipeline, so it must
// gate identically or chat becomes a paywall bypass. Pure so the gate can be
// unit tested without the store graph.

export type EffectivePlan = 'trial' | 'free' | 'pro';

/** True when this plan may run the materials + pricing pipeline via Mate. */
export function canRunMatePipeline(plan: EffectivePlan): boolean {
  return plan !== 'free';
}
