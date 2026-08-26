// Which quotes are mid-pricing right now.
//
// The materials + pricing pipeline runs for 15-40 seconds after Apply, and the
// tradie keeps talking to Mate the whole time. The system prompt tells Mate the
// quote isn't ready until the "[pipeline-done]" line arrives, but a prompt is
// only as good as the model's obedience, and on a stray mid-pipeline turn Mate
// has repeatedly told tradies the quote was ready to view. It isn't: it's a
// draft with no prices on it, and they find out in front of the customer.
//
// So the claim gets a fact behind it. show_quote consults this and refuses
// while a quote is still pricing, which corrects the model inside the turn
// instead of after it has already spoken — the same trick showQuoteGate and
// pendingProposalGate already use for ids that don't render.
//
// Deliberately keyed by quote id, not a global flag: the tradie can perfectly
// well ask to see a DIFFERENT, finished quote while this one prices.

const inFlight = new Set<string>();

export function markPricingStarted(quoteId: string): void {
  if (quoteId) inFlight.add(quoteId);
}

export function markPricingFinished(quoteId: string): void {
  if (quoteId) inFlight.delete(quoteId);
}

export function isPricingInFlight(quoteId: string): boolean {
  return !!quoteId && inFlight.has(quoteId);
}

/** Test seam — module state would otherwise leak between cases. */
export function __resetPricingInFlight(): void {
  inFlight.clear();
}
