/**
 * One bubble per reply, even when the transport hands the reply over in
 * pieces.
 *
 * A voice model that calls tools mid-reply ends a generation turn at every
 * tool call: Gemini Live sends turnComplete before each toolCall, ElevenLabs
 * emits one agent_response per spoken segment. The screen closes the bubble
 * on every one of those, so a single sentence reached a tradie as three
 * bubbles — "No worries — drafting that" / "new circuits," / "and we'll sort
 * RCDs to standard. I'll leave" (3 Sep 2026) — and read like Mate stammering.
 *
 * The rule that fixes it is about the tradie, not the transport: nothing the
 * tradie said separates two fragments, so they are one reply. Text that
 * arrives after a bubble closed, with no tradie speech (and no typed or
 * scripted user turn) in between, continues that bubble. The moment the
 * tradie speaks, the next reply starts fresh.
 *
 * Pure state so the rule is testable without the screen.
 */

export interface ClosedBubble {
  id: string;
  text: string;
}


/** Fragments are appended with one space unless the seam already has whitespace or the new text starts with punctuation. */
export function joinFragments(previous: string, next: string): string {
  if (!previous) return next;
  if (!next) return previous;
  if (/\s$/.test(previous) || /^\s/.test(next) || /^[,.;:!?)]/.test(next)) return previous + next;
  return `${previous} ${next}`;
}

export function createBubbleContinuity() {
  let last: ClosedBubble | null = null;
  return {
    /** The screen just closed an assistant bubble; remember it in case the reply continues. */
    closed(bubble: ClosedBubble): void {
      last = bubble.text ? bubble : null;
    },
    /** The tradie spoke, typed, a scripted user turn went out, or the session reset — the next reply is new. */
    userTurn(): void {
      last = null;
    },
    /**
     * New assistant text is about to open a bubble. Returns the bubble to
     * continue (and forgets it — a continuation closes again through `closed`),
     * or null when a fresh bubble is right.
     */
    takeContinuation(): ClosedBubble | null {
      const found = last;
      last = null;
      return found;
    },
  };
}
