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

let probe: ((quoteId: string) => string | null) | null = null;

export function setRenderableQuoteProbe(
  next: ((quoteId: string) => string | null) | null,
): void {
  probe = next;
}

export type ShowQuoteGateResult =
  | { ok: true; quoteId: string }
  | { ok: false; error: string };

export function gateShowQuote(quoteId: string): ShowQuoteGateResult {
  if (!probe) return { ok: true, quoteId };
  const renderable = probe(quoteId);
  if (renderable) return { ok: true, quoteId: renderable };
  return {
    ok: false,
    error:
      "Couldn't put that quote on screen — the id doesn't match a quote on this phone. Call list_recent_quotes and use the id it returns (not the QU- number), then try show_quote again.",
  };
}
