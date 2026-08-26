// show_quote's dispatcher-side gate.
//
// The dispatcher used to answer { ok: true } unconditionally and leave the
// chat screen to discover AFTER the turn that the id doesn't render — by
// which point the model has already told the tradie "here it is", so the
// screen's "couldn't pull that one up" bubble lands straight under it. The
// screen registers the same store lookup its inline card renders from; the
// gate fails the tool call inside the turn so the model can recover itself
// (re-list, re-ask) before it speaks.
//
// The probe returns the id the card can actually render (it may differ from
// the one passed — a converted quote keeps its id while the legacy mirror
// gets a fresh one), or null when nothing on this device matches. No probe
// registered (screen unmounted, tests) → optimistic pass-through, matching
// the old behaviour; the screen-side nudge stays as the backstop.

import { isPricingInFlight } from './pricingInFlight';

let probe: ((quoteId: string) => string | null) | null = null;

export function setRenderableQuoteProbe(
  next: ((quoteId: string) => string | null) | null,
): void {
  probe = next;
}

export type ShowQuoteGateResult =
  | { ok: true; quoteId: string }
  | { ok: false; error: string };

// Same probe, reused by the proposal validators: a quote-targeting proposal
// against an id that isn't on this device renders a card that can only fail
// on Apply. Returns the renderable id, or the input unchanged when no probe
// is registered (screen unmounted, tests).
export function resolveKnownQuoteId(quoteId: string): string | null {
  if (!probe) return quoteId;
  return probe(quoteId);
}

export function gateShowQuote(quoteId: string): ShowQuoteGateResult {
  // Still pricing. Putting it on screen now shows a draft with no prices, and
  // whatever Mate says alongside it ("here you go", "ready to view") is wrong.
  // Refuse inside the turn so the model corrects itself rather than the tradie
  // discovering it on the Job Preview screen.
  if (isPricingInFlight(quoteId)) {
    return {
      ok: false,
      error:
        "That quote is still going through pricing — it has no prices on it yet, so don't put it on screen and don't tell the tradie it's ready. Wait for the pipeline to finish, then show it.",
    };
  }
  if (!probe) return { ok: true, quoteId };
  const renderable = probe(quoteId);
  if (renderable) return { ok: true, quoteId: renderable };
  return {
    ok: false,
    error:
      "Couldn't put that quote on screen — the id doesn't match a quote on this phone. Call list_recent_quotes and use the id it returns (not the QU- number), then try show_quote again.",
  };
}
