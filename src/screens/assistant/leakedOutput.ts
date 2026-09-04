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
//   3. A NARRATED tool call: the model writes the call out as speech instead
//      of calling it. Sighted 4 Sep 2026 on Gemini Live, twice in one session
//      — `[propose_draft_quote jobName="Install 2 fire alarms" …]` spoken and
//      rendered mid-bubble, no card, no quote, and the tradie left telling
//      Mate it was broken. It learns the shape from our own bracketed turns.
//
// Pure so the patterns can be tested without a live session.

import { ALL_TOOL_DECLARATIONS } from '../../services/assistant/toolSchemas';

// Every bracketed tag we send as a user turn. `greet` was missing from this
// list, which is half of why the sighting above rendered.
const PROMPT_TAGS = ['greet', 'narrate', 'narrate-done', 'pipeline-done', 'context'];
const PROMPT_TAG_RE = new RegExp(`^\\s*\\[(?:${PROMPT_TAGS.join('|')})\\]`, 'i');

/**
 * Names a narrated call can carry. Read off the declarations rather than
 * restated, so a tool added tomorrow is covered without anyone remembering
 * this file — and so nothing that isn't a real tool is ever stripped.
 */
const KNOWN_BRACKET_WORDS = [...PROMPT_TAGS, ...ALL_TOOL_DECLARATIONS.map((d) => d.name)];

/** A complete `[tag]` or `[tool_name arg="…"]`, anywhere in the text. */
const BRACKETED_SCAFFOLD_RE = new RegExp(
  `\\[(?:${KNOWN_BRACKET_WORDS.join('|')})\\b[^\\]]*\\]`,
  'gi',
);

/**
 * A bracket that has opened but not closed at the END of the text — the
 * half-streamed `[propose_dra`. Painting it and un-painting it a frame later
 * is a visible flicker, so it is held back until the closing bracket decides
 * what it was. Only dropped when the word so far could still become one of
 * ours; a bare "[" could become anything, so it waits too.
 */
function dropTrailingPartial(text: string): string {
  const at = text.lastIndexOf('[');
  if (at === -1 || text.indexOf(']', at) !== -1) return text;
  const word = (text.slice(at + 1).match(/^[a-z0-9_-]*/i)?.[0] ?? '').toLowerCase();
  return KNOWN_BRACKET_WORDS.some((n) => n.startsWith(word)) ? text.slice(0, at) : text;
}

/** Just the tool names — a narrated call, not a prompt tag echoed back. */
const NARRATED_TOOL_RE = new RegExp(
  `\\[(${ALL_TOOL_DECLARATIONS.map((d) => d.name).join('|')})\\b[^\\]]*\\]`,
  'i',
);

/**
 * The tool this turn described instead of calling, if it did.
 *
 * Stripping the text keeps it off the tradie's screen, but the ACTION is still
 * missing — on 4 Sep 2026 that meant no card, no quote, and a tradie told
 * twice that a draft existed when none did. The caller uses this to hand the
 * model one chance to make the call for real. Prompt tags deliberately do not
 * count: echoing "[pipeline-done]" is untidy, not a missed action.
 */
export function narratedToolCall(text: string): string | null {
  if (!text) return null;
  return NARRATED_TOOL_RE.exec(text)?.[1] ?? null;
}

/**
 * Take our own scaffolding out of a transcript that is otherwise real speech.
 *
 * isLeakedModelOutput below drops a WHOLE turn, which is right when the turn
 * is nothing but scaffolding. It is wrong when a genuine sentence and a
 * narrated tool call arrive in the same bubble — "Righto, drafting it now" is
 * worth showing, `[propose_draft_quote …]` is not — and it never fired there
 * anyway, because it only ever looked at the START of the text.
 */
export function stripLeakedScaffolding(text: string): string {
  if (!text) return text;
  const cleaned = dropTrailingPartial(text).replace(BRACKETED_SCAFFOLD_RE, '');
  if (cleaned === text) return text;
  return cleaned
    // Tidy the hole the removal left: a doubled space mid-line, a trailing
    // space at end of line, a third blank line.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
