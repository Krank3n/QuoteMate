// Photo caps, and the rule that a photo rides onto exactly one quote.

import { describe, it, expect } from 'vitest';
import {
  ATTACH_LIMIT_COPY,
  canAttachMore,
  collectQuotePhotos,
  markAttachmentConsumedBy,
  markAttachmentsConsumed,
  mostRecentUnconsumedAttachment,
  numberWord,
} from '../chatAttachments';
import { ATTACHMENT_LIMITS } from '../../../services/assistant/attachmentParts';
import type { ChatAttachment, ChatMessage } from '../../../types/assistant';

function att(id: string, extra: Partial<ChatAttachment> = {}): ChatAttachment {
  return { id, status: 'ready', storageUrl: `https://s/${id}.jpg`, ...extra };
}

function msg(id: string, attachments?: ChatAttachment[]): ChatMessage {
  return { id, role: 'user', text: 'here', createdAt: '', ...(attachments ? { attachments } : {}) };
}

/** `count` single photos spread over messages of `perMessage` each. */
function sentPhotos(count: number, perMessage = ATTACHMENT_LIMITS.maxPerTurn): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < count; i += perMessage) {
    const batch = Array.from({ length: Math.min(perMessage, count - i) }, (_, j) => att(`p${i + j}`));
    out.push(msg(`m${out.length}`, batch));
  }
  return out;
}

describe('the caps themselves', () => {
  // Decided 16 Sep 2026 alongside the quote cap going to 30. The byte
  // ceilings are the 1st-gen Cloud Function request limit and do not move.
  it('allow four photos a message and thirty a chat', () => {
    expect(ATTACHMENT_LIMITS.maxPerTurn).toBe(4);
    expect(ATTACHMENT_LIMITS.maxPerChat).toBe(30);
  });
});

describe('numberWord', () => {
  it('spells the caps out the way Mate would say them', () => {
    expect(numberWord(4)).toBe('four');
    expect(numberWord(30)).toBe('thirty');
    expect(numberWord(21)).toBe('twenty-one');
    expect(numberWord(0)).toBe('zero');
  });

  it('falls back to digits outside what it can spell', () => {
    expect(numberWord(100)).toBe('100');
    expect(numberWord(-1)).toBe('-1');
    expect(numberWord(2.5)).toBe('2.5');
  });
});

describe('ATTACH_LIMIT_COPY', () => {
  it('states the per-message cap from ATTACHMENT_LIMITS', () => {
    expect(ATTACH_LIMIT_COPY.perMessage).toBe(
      "Four photos at a time — send these first and I'll take the next lot.",
    );
    expect(ATTACH_LIMIT_COPY.perMessage.toLowerCase()).toContain(numberWord(ATTACHMENT_LIMITS.maxPerTurn));
    expect(ATTACH_LIMIT_COPY.cameraTip).toBe("Four at a time; send them and I'll take the next lot");
  });

  it('states the per-chat cap from ATTACHMENT_LIMITS', () => {
    expect(ATTACH_LIMIT_COPY.perChat).toBe(
      "That's thirty photos this chat — plenty to go on. Start a new chat if you've got more.",
    );
    expect(ATTACH_LIMIT_COPY.perChat).toContain(numberWord(ATTACHMENT_LIMITS.maxPerChat));
  });

  it('never says "AI" or the old numbers', () => {
    for (const line of Object.values(ATTACH_LIMIT_COPY)) {
      expect(line).not.toMatch(/\bAI\b/);
      expect(line).not.toMatch(/\b(two|five) photos\b/i);
    }
  });
});

describe('canAttachMore', () => {
  it('lets a fourth photo onto one message and blocks the fifth', () => {
    expect(canAttachMore({ pending: [{}, {}, {}], messages: [] }).ok).toBe(true);
    const res = canAttachMore({ pending: [{}, {}, {}, {}], messages: [] });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('per_message');
    expect(res.ok === false && res.message).toBe(ATTACH_LIMIT_COPY.perMessage);
  });

  it('lets the thirtieth photo into a chat and blocks the thirty-first', () => {
    expect(canAttachMore({ pending: [], messages: sentPhotos(29) }).ok).toBe(true);
    const res = canAttachMore({ pending: [], messages: sentPhotos(30) });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('per_chat');
    expect(res.ok === false && res.message).toBe(ATTACH_LIMIT_COPY.perChat);
  });

  it('counts photos already in the tray against the chat cap too', () => {
    // 28 sent + 2 pending = 30; one more tips it over the chat, not the message.
    const res = canAttachMore({ pending: [{}, {}], messages: sentPhotos(28) });
    expect(res.ok === false && res.reason).toBe('per_chat');
  });

  it('does not let a failed upload burn a chat slot', () => {
    // Two dropouts on a bad site connection must not cost the tradie the rest
    // of their photos — those photos provably never reached Mate.
    const messages = [
      msg('m1', [att('a'), att('b', { status: 'failed' })]),
      msg('m2', [att('c', { status: 'failed' }), att('d')]),
      msg('m3', [att('e')]),
    ];
    expect(canAttachMore({ pending: [], messages }).ok).toBe(true);
  });

  it('charges a sent plan two slots against the chat cap', () => {
    // 27 singles + one plan = 29 spent, so one more single photo fits and a
    // plan does not.
    const messages = [...sentPhotos(27), msg('plan', [att('plan', { isPlan: true })])];
    expect(canAttachMore({ pending: [], messages }).ok).toBe(true);
    const res = canAttachMore({ pending: [], messages, isPlan: true });
    expect(res.ok === false && res.reason).toBe('per_chat');
  });

  it('counts a hi-res plan double on one message', () => {
    // Two plans fill the four slots; a plan plus two photos leaves one.
    expect(canAttachMore({ pending: [{ isPlan: true }], messages: [], isPlan: true }).ok).toBe(true);
    expect(canAttachMore({ pending: [{ isPlan: true }, { isPlan: true }], messages: [] }).ok).toBe(false);
    expect(canAttachMore({ pending: [{ isPlan: true }, {}, {}], messages: [] }).ok).toBe(false);
    expect(canAttachMore({ pending: [{ isPlan: true }, {}], messages: [] }).ok).toBe(true);
    const res = canAttachMore({ pending: [{ isPlan: true }, {}], messages: [], isPlan: true });
    expect(res.ok === false && res.reason).toBe('per_message');
  });
});

describe('collectQuotePhotos', () => {
  it('maps ready attachments to QuotePhoto', () => {
    expect(collectQuotePhotos([msg('m1', [att('a')])])).toEqual([
      { id: 'a', storageUrl: 'https://s/a.jpg', annotated: false },
    ]);
  });

  it('carries isPlan through', () => {
    expect(collectQuotePhotos([msg('m1', [att('a', { isPlan: true })])])[0].isPlan).toBe(true);
  });

  it('skips uploading and failed attachments', () => {
    const messages = [
      msg('m1', [
        att('up', { status: 'uploading', storageUrl: undefined }),
        att('bad', { status: 'failed' }),
        att('good'),
      ]),
    ];
    expect(collectQuotePhotos(messages).map((p) => p.id)).toEqual(['good']);
  });

  it('skips already-consumed attachments', () => {
    const messages = [
      msg('m1', [
        att('spent', { consumedByQuoteId: 'q1' }),
        att('imported', { consumedBy: 'supplier_import' }),
        att('free'),
      ]),
    ];
    expect(collectQuotePhotos(messages).map((p) => p.id)).toEqual(['free']);
  });

  it('gathers photos across several turns', () => {
    const messages = [msg('m1', [att('a')]), msg('m2'), msg('m3', [att('b')])];
    expect(collectQuotePhotos(messages).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('dedupes by id', () => {
    const messages = [msg('m1', [att('a'), att('a'), att('b')]), msg('m2', [att('b'), att('c')])];
    expect(collectQuotePhotos(messages).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('carries a full chat of thirty onto the draft', () => {
    const ids = collectQuotePhotos(sentPhotos(30)).map((p) => p.id);
    expect(ids).toHaveLength(30);
    expect(ids[0]).toBe('p0');
    expect(ids[29]).toBe('p29');
  });
});

describe('markAttachmentsConsumed', () => {
  it('stamps every carried attachment', () => {
    const messages = [msg('m1', [att('a')]), msg('m2', [att('b'), att('spent', { consumedByQuoteId: 'q0' })])];
    const patches = markAttachmentsConsumed(messages, 'q1');
    expect(patches.map((p) => p.messageId)).toEqual(['m1', 'm2']);
    expect(patches[0].attachments[0].consumedByQuoteId).toBe('q1');
    expect(patches[1].attachments[0].consumedByQuoteId).toBe('q1');
    // Already spent on an earlier quote — left pointing at that one.
    expect(patches[1].attachments[1].consumedByQuoteId).toBe('q0');
    // A second draft in the same chat inherits nothing.
    const after = patches.reduce<ChatMessage[]>(
      (acc, p) => acc.map((m) => (m.id === p.messageId ? { ...m, attachments: p.attachments } : m)),
      messages,
    );
    expect(collectQuotePhotos(after)).toEqual([]);
  });

  it('returns no patches when nothing is carryable', () => {
    expect(markAttachmentsConsumed([msg('m1')], 'q1')).toEqual([]);
  });

  // The pipeline runs 20-40s. A photo that finished uploading during it was
  // never on this draft and must not be stamped as though it were.
  it('stamps only the ids handed to it, not whatever is carryable now', () => {
    const before = [msg('m1', [att('a')])];
    const carriedIds = collectQuotePhotos(before).map((p) => p.id);
    // ...meanwhile a second upload settles.
    const after = [msg('m1', [att('a'), att('late')])];

    const patches = markAttachmentsConsumed(after, 'q1', carriedIds);
    expect(patches[0].attachments[0].consumedByQuoteId).toBe('q1');
    expect(patches[0].attachments[1].consumedByQuoteId).toBeUndefined();
    // The late photo is still free for the next draft.
    const settled = [{ ...after[0], attachments: patches[0].attachments }];
    expect(collectQuotePhotos(settled).map((p) => p.id)).toEqual(['late']);
  });
});

// Mate only ever says "the photo they just sent" — it never names an id, so
// the screen has to resolve which one that is.
describe('mostRecentUnconsumedAttachment', () => {
  it('picks the newest photo nobody has spent', () => {
    const messages = [msg('m1', [att('old')]), msg('m2', [att('newer'), att('newest')])];
    expect(mostRecentUnconsumedAttachment(messages)?.id).toBe('newest');
  });

  it('skips photos already claimed by a quote or an import', () => {
    const messages = [
      msg('m1', [att('free')]),
      msg('m2', [att('onQuote', { consumedByQuoteId: 'q1' }), att('imported', { consumedBy: 'supplier_import' })]),
    ];
    expect(mostRecentUnconsumedAttachment(messages)?.id).toBe('free');
  });

  it('is null when there is nothing spare', () => {
    expect(mostRecentUnconsumedAttachment([msg('m1')])).toBeNull();
    expect(mostRecentUnconsumedAttachment([msg('m1', [att('up', { status: 'uploading' })])])).toBeNull();
  });
});

describe('markAttachmentConsumedBy', () => {
  it('claims one photo for the import so it cannot also become a site photo', () => {
    const messages = [msg('m1', [att('a'), att('b')])];
    const patches = markAttachmentConsumedBy(messages, 'a', 'supplier_import');
    expect(patches[0].attachments[0].consumedBy).toBe('supplier_import');
    expect(patches[0].attachments[1].consumedBy).toBeUndefined();
    const after = [{ ...messages[0], attachments: patches[0].attachments }];
    expect(collectQuotePhotos(after).map((p) => p.id)).toEqual(['b']);
  });
});

// Every appendMessage/updateMessage schedules a Firestore write of `messages`
// verbatim. A base64 payload on an attachment would blow the 1MB doc limit and
// re-bill on every 4s flush — so the shape must never grow one.
describe('Firestore safety', () => {
  it('a chat attachment carries no base64 payload onto the message', () => {
    const attachment = att('a', { isPlan: true, mimeType: 'image/jpeg', localUri: 'file:///tmp/a.jpg' });
    const message = msg('m1', [attachment]);
    const serialised = JSON.stringify(message);
    expect(serialised.length).toBeLessThan(600);
    for (const key of Object.keys(attachment)) {
      expect(key).not.toMatch(/base64|data|bytes/i);
    }
    // And the carried QuotePhoto is a URL reference, not bytes.
    for (const photo of collectQuotePhotos([message])) {
      expect(photo.storageUrl.startsWith('https://')).toBe(true);
      expect(JSON.stringify(photo)).not.toContain('base64');
    }
  });
});
