/**
 * A spoken turn Mate never got to answer must say so in the chat.
 *
 * Typed messages can't go unanswered: `submit` mounts the assistant bubble in
 * the same tick as the user message, and every exit from `driveTurn` either
 * fills it or writes an error into it. Voice has no such placeholder — the
 * tradie's words land as a bare user message and the reply only appears when
 * an output transcription arrives. When the session ends first (the app
 * backgrounded past its grace, the tradie tapped the mic off, the server
 * closed, a socket drop threw the in-flight turn away), the turn was simply
 * gone: no reply, no error, and the synced transcript shows a user message
 * with nothing after it (seen 14 Sep 2026).
 *
 * Pure state so the rule is testable without the screen: remember which
 * conversation is owed a reply, forget it as soon as Mate starts one, and hand
 * the debt back when the session goes away.
 */
import type { ChatMessage } from '../../types/assistant';

export const UNANSWERED_TURN_MESSAGE =
  "Mate dropped off before answering that one — tap Send again, or say it once more.";

export function createUnansweredTurn() {
  let owedTo: string | null = null;
  return {
    /** The tradie's speech opened a user bubble in this conversation; a reply is now owed. */
    spoken(conversationId: string): void {
      owedTo = conversationId;
    },
    /** Mate started (or finished) a reply — nothing is owed any more. */
    answered(): void {
      owedTo = null;
    },
    /**
     * The session is going away. Returns the conversation still owed a reply
     * (and forgets it, so a later teardown can't bill the same turn twice),
     * or null when every spoken turn got its answer.
     */
    takeOwed(): string | null {
      const found = owedTo;
      owedTo = null;
      return found;
    },
  };
}

/**
 * The bubble that stands in for the lost reply. Empty text keeps it out of
 * the history seeded to the model; the CTA re-drives the turn over that
 * history, exactly as a failed typed turn's "Send again" does.
 */
export function unansweredTurnBubble(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    text: '',
    createdAt: new Date().toISOString(),
    errorMessage: UNANSWERED_TURN_MESSAGE,
    cta: { label: 'Send again', action: { type: 'retry_send' } },
  };
}
