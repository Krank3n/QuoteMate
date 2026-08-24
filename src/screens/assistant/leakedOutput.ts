// Guards the chat against the model's own scaffolding reaching a tradie.
//
// Two failure modes, both seen in production:
//   1. A bracketed prompt tag echoed back verbatim ("[narrate] …").
//   2. Chain-of-thought: the model narrating its plan instead of speaking.
//      Sighted 23 Aug 2026 on the voice greeting — a tradie opened Mate and
//      got "Thought to self: The user wants me to start the conversation with
//      a short Aussie greeting. Greeting constraints: - 1-2 sentences max…",
//      i.e. our own greet prompt read back to them, followed by drafts of the
//      line it was about to say.
//
// Pure so the patterns can be tested without a live session.

// Every bracketed tag we send as a user turn. `greet` was missing from this
// list, which is half of why the sighting above rendered.
const PROMPT_TAG_RE = /^\s*\[(greet|narrate|narrate-done|pipeline-done|context)\]/i;

// Markers of the model planning out loud rather than talking to the tradie.
// Deliberately high-signal: Mate addresses the tradie as "you" and never
// refers to "the user", never numbers drafts, and never recites constraints.
// A false positive silently eats a reply, so nothing vague goes in here.
const CHAIN_OF_THOUGHT_RES: RegExp[] = [
  /^\s*thoughts?\s+to\s+self\s*:/i,
  /^\s*thoughts?\s*:/i,
  /^\s*thinking\s*:/i,
  /^\s*\(?\s*internal\s+(monologue|thought)/i,
  /^\s*constraints\s*:/i,
  /^\s*draft\s+\d+\s*:/im,
  /\bgreeting\s+constraints\b/i,
  /\bthe\s+user\s+wants\s+me\s+to\b/i,
  /\blet'?s\s+(assemble|refine)\s+(this|that|it)\b/i,
  /\blet\s+me\s+(assemble|refine)\s+(this|that|it)\b/i,
];

/**
 * True when this transcript is the model's scaffolding rather than something
 * to show. Callers should test the ACCUMULATED text, not a single streamed
 * chunk — "Thought to self:" routinely arrives split across deltas.
 */
export function isLeakedModelOutput(text: string): boolean {
  if (!text?.trim()) return false;
  if (PROMPT_TAG_RE.test(text)) return true;
  return CHAIN_OF_THOUGHT_RES.some((re) => re.test(text));
}
