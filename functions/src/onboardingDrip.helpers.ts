/**
 * Pure scheduling ladder for the sendOnboardingDrip cron (index.ts), split
 * out so it unit-tests like the other *.helpers modules.
 *
 * Consolidated 2026-07 (emailLog audit): the five-tip drip ran at 9–16%
 * opens, with tips 2 (supplier prices) and 3 (accept online) the weakest —
 * and tip 4's send-it copy already covered tip 3's acceptance-link and
 * notification points. Three sends remain, keyed by their ORIGINAL tip
 * numbers so in-flight lastOnboardingTip state needs no migration:
 *
 *   day 1    tip 1  voice quoting (best-opening feature tip)
 *   day 4    tip 4  send it to win it — the activation event, moved up
 *                   from day 10
 *   day 14   tip 5  Tom's first-quote note (never-activated cohort only;
 *                   the caller gates it on no-trial/no-Pro)
 *
 * Legacy states resolve naturally: lastTip 2 or 3 (mid-drip when tips 2/3
 * retired) advances straight to tip 4 once day 4 passes; the ladder can
 * never select a retired tip.
 */
export function onboardingTipDue(daysSinceSignup: number, lastTip: number): number {
  if (daysSinceSignup >= 14 && lastTip < 5) return 5;
  if (daysSinceSignup >= 4 && lastTip < 4) return 4;
  if (daysSinceSignup >= 1 && lastTip < 1) return 1;
  return 0;
}
