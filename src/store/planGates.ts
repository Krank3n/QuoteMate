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

/**
 * True when the pipeline may send the quote's photos to the vision model.
 * Mirrors the wizard, which reads `subscriptionStatus.isPro || isTrialActive`
 * (MaterialsListScreen) — a trial user gets photo analysis there, so a trial
 * user must get it from Mate too. Reading this as `=== 'pro'` silently drops
 * every attached plan for trial users, which is most of them.
 */
export function canAnalysePhotos(plan: EffectivePlan): boolean {
  return plan !== 'free';
}
