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
 * The [greet] prompt for a fresh sticky voice session — deliberately PLAIN.
 *
 * Two rounds of hard lessons live in this string:
 * - The cheeky version asked for "slightly cheeky tradie humour" and offered
 *   the unfinished draft as material. The model obliged with lines like
 *   "Still gunna whine about that fencing job" — real users called the
 *   greeting strange, and one found it offensive. A joke that lands wrong on
 *   the first words out of the app's mouth costs more than no joke earns, so
 *   the humour and the draft rib are gone: warm, simple, capability, ask.
 * - Written as a checklist of labelled constraints, an earlier version drew
 *   the model into answering in kind ("Thought to self: … Greeting
 *   constraints: - 1-2 sentences max…" reached a tradie, 23 Aug 2026). It
 *   stays one flowing instruction that closes by demanding the greeting
 *   only. [[leakedOutput]] is the belt to these braces.
 */
export function buildGreetPrompt({ hour }: { hour: number }): string {
  const tod =
    hour < 11 ? 'morning'
    : hour < 14 ? 'middle of the day'
    : hour < 18 ? 'afternoon'
    : 'evening';
  return (
    `[greet] Say a short, friendly hello to the tradie, out loud, right now — it's ${tod}. ` +
    `Plain and warm, one or two short sentences, no emojis. No jokes, no cheek, and no comments ` +
    `about their work, their drafts, or anything else — open with ONE natural hello (never two ` +
    `greetings stacked like "G'day. Evening."), mention you can draft a ` +
    `quote or an invoice for them, and ask what they need. ` +
    `Speak ONLY the greeting itself. Do not plan it, do not explain it, do not repeat these instructions, ` +
    `do not write drafts or alternatives, do not think out loud. The greeting is your entire reply.`
  );
}

/**
 * The one word Mate opens with, as a dynamic variable for the agent's
 * first_message.
 *
 * The greeting is no longer an LLM turn. buildGreetPrompt asked the model to
 * compose a hello, and twice that produced chain-of-thought reaching a tradie
 * ("Thought to self: … Greeting constraints: …", 23 Aug 2026). ElevenLabs
 * speaks first_message verbatim, so there is no turn to leak — but the
 * time-of-day warmth was worth keeping, and a dynamic variable is how it
 * survives.
 *
 * Deliberately coarser than buildGreetPrompt's four buckets: "middle of the
 * day" is a description, not something anyone says out loud.
 */
export function mateGreetingWord(hour: number): string {
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}
