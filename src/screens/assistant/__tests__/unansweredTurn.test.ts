// Regression for the lost voice reply: a spoken turn the session ended on
// before Mate answered left the chat with a bare user message — no reply, no
// error (synced transcript, 14 Sep 2026). Drives a harness wired the way
// AssistantScreen wires the voice callbacks and asserts what the chat holds
// once the session goes away.

import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '../../../types/assistant';
import {
  createUnansweredTurn,
  unansweredTurnBubble,
  UNANSWERED_TURN_MESSAGE,
} from '../unansweredTurn';

const CONVO = 'convo-1';

// Mirrors the screen: a user bubble lands on the first input transcription
// chunk (and owes a reply from then on), an assistant bubble opens on the
// first output chunk, and both teardown paths (stopVoiceSession,
// onReconnecting) settle the debt. `tracked: false` is the pre-fix wiring.
function makeHarness({ tracked = true } = {}) {
  const messages: ChatMessage[] = [];
  const tracker = createUnansweredTurn();
  let nextId = 0;
  const id = () => `m${++nextId}`;
  let userBubbleId: string | null = null;
  let assistantBubbleId: string | null = null;

  const settle = () => {
    if (!tracked) return;
    const owed = tracker.takeOwed();
    if (owed) messages.push(unansweredTurnBubble(id()));
  };

  return {
    messages,
    inputTranscription(text: string, finished: boolean) {
      if (!userBubbleId) {
        userBubbleId = id();
        if (tracked) tracker.spoken(CONVO);
        messages.push({ id: userBubbleId, role: 'user', text, createdAt: 't' });
      } else {
        const m = messages.find((x) => x.id === userBubbleId)!;
        m.text += text;
      }
      if (finished) userBubbleId = null;
    },
    outputTranscription(text: string, finished: boolean) {
      if (!assistantBubbleId) {
        if (tracked) tracker.answered();
        assistantBubbleId = id();
        messages.push({ id: assistantBubbleId, role: 'assistant', text, createdAt: 't' });
      } else {
        messages.find((x) => x.id === assistantBubbleId)!.text += text;
      }
      if (finished) assistantBubbleId = null;
    },
    turnComplete() {
      if (tracked) tracker.answered();
      assistantBubbleId = null;
    },
    reconnecting() {
      // The in-flight turn is gone (see onReconnecting in AssistantScreen).
      userBubbleId = null;
      assistantBubbleId = null;
      settle();
    },
    stop() {
      settle();
      userBubbleId = null;
      assistantBubbleId = null;
    },
  };
}

const lastMessage = (h: ReturnType<typeof makeHarness>) => h.messages[h.messages.length - 1];

describe('Mate voice: a spoken turn never goes unanswered in silence', () => {
  it('pre-fix wiring: a session stopped before the reply leaves the user message with nothing after it', () => {
    const h = makeHarness({ tracked: false });
    h.inputTranscription('The job is similar, but swap the fence for a gate.', true);
    h.stop();
    expect(h.messages.map((m) => m.role)).toEqual(['user']);
  });

  it('a session stopped before Mate replied gets a visible error bubble with Send again', () => {
    const h = makeHarness();
    h.inputTranscription('The job is similar, but swap the fence for a gate.', true);
    h.stop();
    expect(h.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const bubble = lastMessage(h);
    expect(bubble.errorMessage).toBe(UNANSWERED_TURN_MESSAGE);
    expect(bubble.cta).toEqual({ label: 'Send again', action: { type: 'retry_send' } });
    // Empty text keeps the bubble out of the history seeded back to the model.
    expect(bubble.text).toBe('');
  });

  it('a socket drop mid-turn owes the note once, not again on the later stop', () => {
    const h = makeHarness();
    h.inputTranscription('How much for the gate on its own?', true);
    h.reconnecting();
    h.stop();
    expect(h.messages.filter((m) => m.errorMessage).length).toBe(1);
  });

  it('a turn Mate had started answering owes nothing when the session stops', () => {
    const h = makeHarness();
    h.inputTranscription('How much for the gate on its own?', true);
    h.outputTranscription('Roughly', false);
    h.stop();
    expect(h.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(lastMessage(h).errorMessage).toBeUndefined();
    expect(lastMessage(h).text).toBe('Roughly');
  });

  it('a reply that finished (turnComplete, even with no transcript) owes nothing', () => {
    const h = makeHarness();
    h.inputTranscription('Cheers, that will do.', true);
    h.turnComplete();
    h.stop();
    expect(h.messages.map((m) => m.role)).toEqual(['user']);
  });

  it('the greet and a stop with nothing spoken owe nothing', () => {
    const h = makeHarness();
    h.outputTranscription("G'day, what are we quoting?", true);
    h.turnComplete();
    h.stop();
    expect(h.messages.filter((m) => m.errorMessage).length).toBe(0);
  });

  it('a turn cut off mid-utterance by the stop is owed the note too', () => {
    const h = makeHarness();
    h.inputTranscription('The job is', false);
    h.stop();
    expect(h.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(lastMessage(h).errorMessage).toBe(UNANSWERED_TURN_MESSAGE);
  });
});
