// Prior conversation, formatted for an ElevenLabs contextual update.
//
// The Gemini Live path seeded history as a real `clientContent` turn with
// turnComplete:false. ElevenLabs has no equivalent — you cannot prefill a
// transcript — but it has something that fits better: sendContextualUpdate,
// which is explicitly non-reply-triggering. That is exactly the semantics the
// old turnComplete:false hack was hand-rolling.
//
// Formatted as a "[context]" line because the system prompt already teaches
// Mate how to read those: silent system updates, never to be spoken about as
// if the tradie had said them.

import { ChatMessage } from '../../types/assistant';
import { MAX_HISTORY_TURNS } from './liveSession';

/**
 * Roughly how much transcript is worth carrying. The whole thing lands in the
 * agent's context and is re-billed on every subsequent turn, so a long chat
 * gets its tail, not its head.
 */
export const MAX_SEED_CHARS = 2_000;

/**
 * Build the seed, or null when there's nothing worth sending.
 *
 * Hidden messages are skipped: they're either the leak filter's blanked bubbles
 * or the "[context]" notes we already fed Mate once. Re-seeding those would
 * teach it that bracketed framing is ordinary conversation, which is the exact
 * habit that has leaked prompt tags into what tradies hear.
 */
export function buildSeedContext(history: ChatMessage[]): string | null {
  const turns = history
    .slice(-MAX_HISTORY_TURNS)
    .filter((m) => !m.hidden && m.text?.trim());

  if (!turns.length) return null;

  const lines = turns.map(
    (m) => `${m.role === 'assistant' ? 'You' : 'Tradie'}: ${m.text.trim()}`,
  );

  // Trim from the front — the most recent exchange is the one that matters.
  while (lines.length > 1 && lines.join('\n').length > MAX_SEED_CHARS) {
    lines.shift();
  }

  return `[context] Earlier in this chat:\n${lines.join('\n')}`;
}
