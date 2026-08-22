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
    `[greet] Kick off the chat with ONE short Aussie greeting, 1–2 sentences max. ` +
    `Dry, warm, slightly cheeky tradie humour. No emojis. Work in ONE quick line on what you can do — draft a quote, price materials, sort an invoice — said like a mate, not a sales pitch. ` +
    `Time of day: ${tod}. ${draftHint} ` +
    `End by inviting them to tell you what they need. Then stop and wait.`
  );
}
