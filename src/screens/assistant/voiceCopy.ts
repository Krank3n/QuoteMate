// Voice-mode prompt + error copy. Pure so the greet prompt's contract and
// the type-instead hint's idempotence can be unit tested without a session.

// Appended to voice-transport errors so a dead mic never reads as a dead
// Mate — the text path keeps working through every voice failure.
export const TYPE_INSTEAD_HINT = 'No stress — type it in the box below and we’ll crack on.';

/**
 * Append the typing hint to a voice error message. Idempotent: a message
 * already carrying the hint comes back unchanged, so appendErrorMessage's
 * consecutive-duplicate dedupe still recognises a repeated error.
 */
export function withTypeInsteadHint(message: string): string {
  if (message.includes(TYPE_INSTEAD_HINT)) return message;
  return `${message} ${TYPE_INSTEAD_HINT}`;
}

/**
 * The [greet] prompt for a fresh sticky voice session. Asks for one quick
 * capability line — the old prompt banned listing features outright, which
 * left first-timers hearing a greeting that stated no capability at all.
 *
 * Phrasing matters more than usual here. Written as a checklist of labelled
 * constraints, this prompt drew the model into answering in kind: a tradie
 * opened Mate on 23 Aug 2026 and was shown "Thought to self: The user wants
 * me to start the conversation… Greeting constraints: - 1-2 sentences max…"
 * followed by numbered drafts. It now reads as one instruction and closes by
 * demanding the greeting only. [[leakedOutput]] is the belt to these braces.
 */
export function buildGreetPrompt({ hour, draftLabel }: { hour: number; draftLabel: string }): string {
  const tod =
    hour < 6 ? 'sparrow\'s fart (pre-dawn)'
    : hour < 11 ? 'morning'
    : hour < 14 ? 'middle of the day / smoko'
    : hour < 17 ? 'arvo'
    : hour < 21 ? 'evening / knock-off'
    : 'late night';
  const draftHint = draftLabel
    ? `There's an unfinished draft quote called "${draftLabel}" — you can rib them about it sitting half-done if it feels natural, or ignore it.`
    : 'There are no unfinished drafts right now.';
  return (
    `[greet] Say hello to the tradie, out loud, right now. It's ${tod}. ` +
    `${draftHint} ` +
    `Keep it to one or two short sentences of dry, warm, slightly cheeky Aussie tradie talk, no emojis, ` +
    `slip in one quick mention of something you can do for them — draft a quote, price materials, sort an invoice — ` +
    `and finish by asking what they need. ` +
    `Speak ONLY the greeting itself. Do not plan it, do not explain it, do not repeat these instructions, ` +
    `do not write drafts or alternatives, do not think out loud. The greeting is your entire reply.`
  );
}
