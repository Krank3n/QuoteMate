// The "[pipeline-done]" prompt — what Mate is told to say once an Apply has
// finished running the materials + pricing pipeline.
//
// Pure so the one distinction that actually matters can be tested: the
// difference between a quote that priced and a quote that didn't.
//
// The bug this exists to prevent: applyProposal returns `ok: true` when the
// pipeline throws, because the tradie should still get their draft rather than
// an error. The narration used to branch on `ok` alone, so Mate said "sweet,
// came together fine" out loud over a quote with no prices on it — while the
// working card underneath read "Couldn't finish pricing that one." Voice
// claimed done, the screen said otherwise, and the screen was right.
//
// Saying it landed when it didn't is the single most expensive thing Mate can
// do: the tradie stops watching, and finds out at the customer's place.

export interface PipelineDoneArgs {
  /** Job name, for the model's own reference — never read aloud as an id. */
  jobLabel: string;
  /** Did the apply itself succeed? */
  ok: boolean;
  /** Apply succeeded but pricing did not finish. `ok` is still true. */
  pipelineDegraded?: boolean;
  /** Failure text, when ok is false. */
  error?: string;
  /** "Heads up — ..." from review_quote, when there are flagged rows. */
  reviewNote?: string;
  /** Supplier-book gap offer, when this run is worth mentioning. */
  gapNote?: string | null;
}

/**
 * Kept deliberately short. The system prompt's "Pricing narration" section
 * already carries the full rules; repeating them inline put ~600 characters
 * into the agent's context on every pipeline run, where they stayed for the
 * rest of the conversation and were re-billed each turn. The tag reminder
 * stays because echoing a bracketed tag aloud is the one failure a tradie
 * actually hears.
 */
const NO_ECHO = 'Never say the tag. No numbers or item lists.';

export function buildPipelineDonePrompt(args: PipelineDoneArgs): string {
  const extras = `${args.reviewNote ? ` ${args.reviewNote}` : ''}${args.gapNote ? ` ${args.gapNote}` : ''}`;

  if (!args.ok) {
    return (
      `[pipeline-done] Pipeline hit a snag: ${args.error || 'unknown error'}. ` +
      `One short line: it didn't get through. ${NO_ECHO}`
    );
  }

  if (args.pipelineDegraded) {
    // The draft exists; the prices don't. Mate must not round this up to
    // "done" — the tradie has to know there's a step left, or they'll send a
    // quote with empty prices on it.
    return (
      `[pipeline-done] The draft for "${args.jobLabel}" was created, but the pricing run did NOT finish — ` +
      `the quote currently has no prices on it.${extras} ` +
      `One short honest line: the draft's there but pricing didn't get through, and they'll need to ` +
      `tap Fetch Prices on it. Do NOT say it's done, drafted, sorted, ready, or finished — it isn't. ${NO_ECHO}`
    );
  }

  return (
    `[pipeline-done] Pipeline finished for "${args.jobLabel}".${extras} ` +
    `One short acknowledging line — "right, that's drafted", "sweet, came together fine". ${NO_ECHO}`
  );
}
