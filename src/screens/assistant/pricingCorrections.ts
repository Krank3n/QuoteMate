/**
 * What the tradie said while pricing ran.
 *
 * The materials + pricing run takes 15–40 s after Apply, and the tradie keeps
 * talking: "using red dot brand", "change those numbers", "those detectors
 * are pre-existing, I'm just replacing existing hardwire" (3 Sep 2026). In
 * voice those lines land while Mate is in narration mode; in text the tools
 * refuse a scope change on a quote still being priced. Either way the next
 * bubble was the canned "Here's the draft" and the corrections were gone —
 * the draft still supplied four alarms the customer already owned.
 *
 * So they are kept, and handed to Mate the moment pricing lands: in the
 * "[pipeline-done]" prompt (voice) and the send-offer / pricing-finished
 * "[context]" line (text), with the instruction to fold them in through
 * propose_update_quote_scope. Pure; the screen owns the timing.
 */

/** Most lines kept per run — a tradie on a roll, not a transcript. */
const MAX_LINES = 6;
const MAX_CHARS = 200;

export function createPricingCorrections() {
  let active = false;
  let lines: string[] = [];
  return {
    /** A pipeline apply (draft, scope update, reprice) has started. */
    start(): void {
      active = true;
      lines = [];
    },
    /** True between start() and drain() — the window in which the tradie's words are corrections. */
    isActive(): boolean {
      return active;
    },
    /** The tradie said or typed something while pricing runs. Bracketed prompt tags are never corrections. */
    note(text: string): void {
      const t = (text || '').replace(/\s+/g, ' ').trim();
      if (!active || !t || t.startsWith('[')) return;
      if (lines.length >= MAX_LINES) return;
      lines.push(t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS - 1)}…` : t);
    },
    /** Pricing finished: hand the lines over and stop collecting. */
    drain(): string[] {
      active = false;
      const out = lines;
      lines = [];
      return out;
    },
  };
}

/**
 * The instruction that rides with the corrections, for the "[pipeline-done]"
 * prompt and the "[context]" line. Empty when there is nothing to act on.
 */
export function correctionsClause(lines: string[], quoteId?: string): string {
  if (!lines.length) return '';
  const quoted = lines.map((l) => `"${l}"`).join(', ');
  const target = quoteId ? ` on ${quoteId}` : '';
  return (
    ` While pricing ran the tradie said: ${quoted}. Those are corrections to THIS quote — act on them now: ` +
    `say you're folding them in, then propose_update_quote_scope${target} with the full corrected description ` +
    `(or propose_update_customer / propose_update_line_item where that's what they meant). Never draft a new quote for them.`
  );
}
