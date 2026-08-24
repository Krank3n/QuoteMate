// Photo bytes are the most expensive thing Mate can send. These pin the two
// rules that keep a turn affordable: bytes ride ONCE (on the turn attached,
// never on history replay), and the per-message / per-request caps hold.

import { describe, it, expect } from 'vitest';
import {
  ATTACHMENT_LIMITS,
  buildAttachmentParts,
  buildMessageParts,
  inlineAttachmentIds,
} from '../attachmentParts';
import type { ChatAttachment, ChatMessage } from '../../../types/assistant';

function att(id: string, extra: Partial<ChatAttachment> = {}): ChatAttachment {
  return { id, status: 'ready', storageUrl: `https://s/${id}`, ...extra };
}

function userMsg(id: string, text: string, attachments?: ChatAttachment[]): ChatMessage {
  return { id, role: 'user', text, createdAt: '', ...(attachments ? { attachments } : {}) };
}

function modelMsg(id: string, text: string): ChatMessage {
  return { id, role: 'assistant', text, createdAt: '' };
}

const bytes = (chars: number) => ({ mimeType: 'image/jpeg', data: 'x'.repeat(chars) });

describe('inlineAttachmentIds', () => {
  it('inlines attachments on the trailing user turn', () => {
    const ids = inlineAttachmentIds([
      modelMsg('a1', 'righto'),
      userMsg('u1', 'have a look', [att('p1')]),
    ]);
    expect([...ids]).toEqual(['p1']);
  });

  it('does NOT inline from a turn the assistant already replied to', () => {
    const ids = inlineAttachmentIds([
      userMsg('u1', 'have a look', [att('p1')]),
      modelMsg('a1', 'looks like a paling fence'),
      userMsg('u2', 'how much?'),
    ]);
    expect(ids.has('p1')).toBe(false);
  });

  it('inlines across two consecutive user messages', () => {
    const ids = inlineAttachmentIds([
      modelMsg('a1', 'go on'),
      userMsg('u1', 'first one', [att('p1')]),
      userMsg('u2', 'and this', [att('p2')]),
    ]);
    expect([...ids].sort()).toEqual(['p1', 'p2']);
  });

  it('still inlines after a failed turn left an error bubble behind', () => {
    // No signal on site is the headline case for photos. The retry has to send
    // the bytes — the model never got them the first time.
    const ids = inlineAttachmentIds([
      userMsg('u1', 'have a look', [att('p1')]),
      { id: 'e1', role: 'assistant', text: '', createdAt: '', errorMessage: 'Mate is offline.' },
      userMsg('u2', 'try again'),
    ]);
    expect(ids.has('p1')).toBe(true);
  });

  it('does not walk past an assistant turn that actually replied', () => {
    const ids = inlineAttachmentIds([
      userMsg('u1', 'have a look', [att('p1')]),
      modelMsg('a1', 'timber paling, looks rooted'),
      userMsg('u2', 'price it up'),
    ]);
    expect(ids.has('p1')).toBe(false);
  });
});

describe('buildAttachmentParts', () => {
  it('emits inlineData per kept image', () => {
    const { parts, skipped } = buildAttachmentParts([
      { id: 'p1', bytes: bytes(10) },
      { id: 'p2', bytes: bytes(10) },
    ]);
    expect(parts).toEqual([
      { inlineData: { mimeType: 'image/jpeg', data: 'x'.repeat(10) } },
      { inlineData: { mimeType: 'image/jpeg', data: 'x'.repeat(10) } },
    ]);
    expect(skipped).toEqual([]);
  });

  it('drops the third image and reports it skipped', () => {
    const { parts, skipped } = buildAttachmentParts([
      { id: 'p1', bytes: bytes(10) },
      { id: 'p2', bytes: bytes(10) },
      { id: 'p3', bytes: bytes(10) },
    ]);
    expect(parts).toHaveLength(2);
    expect(skipped).toEqual([{ id: 'p3', reason: 'per_turn_limit' }]);
  });

  it('counts a hi-res plan double against the per-turn allowance', () => {
    const { parts, skipped } = buildAttachmentParts([
      { id: 'plan', isPlan: true, bytes: bytes(10) },
      { id: 'p2', bytes: bytes(10) },
    ]);
    expect(parts).toHaveLength(1);
    expect(skipped).toEqual([{ id: 'p2', reason: 'per_turn_limit' }]);
  });

  it('drops an image over the per-file cap', () => {
    const { parts, skipped } = buildAttachmentParts([
      { id: 'huge', bytes: bytes(ATTACHMENT_LIMITS.maxBase64CharsEach + 1) },
      { id: 'p2', bytes: bytes(10) },
    ]);
    expect(parts).toHaveLength(1);
    expect(skipped).toEqual([{ id: 'huge', reason: 'too_big' }]);
  });

  it('stops once the per-request budget is spent', () => {
    const { parts, skipped, usedChars } = buildAttachmentParts(
      [
        { id: 'p1', bytes: bytes(100) },
        { id: 'p2', bytes: bytes(100) },
      ],
      { remainingChars: 150 },
    );
    expect(parts).toHaveLength(1);
    expect(usedChars).toBe(100);
    expect(skipped).toEqual([{ id: 'p2', reason: 'budget_spent' }]);
  });

  it('reports an unreadable photo instead of emitting a broken part', () => {
    const { parts, skipped } = buildAttachmentParts([{ id: 'p1', bytes: null }]);
    expect(parts).toEqual([]);
    expect(skipped).toEqual([{ id: 'p1', reason: 'unreadable' }]);
  });
});

describe('buildMessageParts', () => {
  it('puts inlineData before text', () => {
    const parts = buildMessageParts(userMsg('u1', 'what fence is this?', [att('p1')]), [
      { inlineData: bytes(4) },
    ], 0);
    expect(parts).toEqual([
      { inlineData: bytes(4) },
      { text: 'what fence is this?' },
    ]);
  });

  it('image-only turn has no empty text part', () => {
    const parts = buildMessageParts(userMsg('u1', '', [att('p1')]), [{ inlineData: bytes(4) }], 0);
    expect(parts).toEqual([{ inlineData: bytes(4) }]);
  });

  it('appends an "attached earlier" marker for photos it did not send', () => {
    const parts = buildMessageParts(userMsg('u1', 'how much?', [att('p1')]), [], 1);
    expect(parts).toEqual([
      { text: 'how much?' },
      { text: '[1 photo(s) attached to this message earlier in the chat]' },
    ]);
  });

  it('returns [] for an empty-text bubble with no attachments', () => {
    expect(buildMessageParts(userMsg('u1', ''), [], 0)).toEqual([]);
    expect(buildMessageParts(userMsg('u1', '   '), [], 0)).toEqual([]);
  });

  // Conflating "you saw this last turn" with "this never arrived" is how Mate
  // ends up confidently describing a photo it has never seen.
  it('marks an unread photo differently from one attached earlier', () => {
    const unread = buildMessageParts(userMsg('u1', 'how much?', [att('p1')]), [], 0, 1);
    expect(unread[1]).toEqual({
      text:
        '[1 photo(s) on this message could not be read — you have NOT seen them. ' +
        "Say the photo didn't come through and ask for a closer shot of the bit that matters.]",
    });
    expect(JSON.stringify(unread)).not.toContain('attached to this message earlier');
  });

  it('can report both kinds on one message', () => {
    const parts = buildMessageParts(userMsg('u1', 'these two', [att('p1'), att('p2')]), [], 1, 1);
    expect(parts).toHaveLength(3);
    expect(JSON.stringify(parts[1])).toContain('attached to this message earlier');
    expect(JSON.stringify(parts[2])).toContain('could not be read');
  });
});
