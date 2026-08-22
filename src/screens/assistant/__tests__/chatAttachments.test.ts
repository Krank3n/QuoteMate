// Photo caps, and the rule that a photo rides onto exactly one quote.

import { describe, it, expect } from 'vitest';
import {
  canAttachMore,
  collectQuotePhotos,
  markAttachmentConsumedBy,
  markAttachmentsConsumed,
  mostRecentUnconsumedAttachment,
} from '../chatAttachments';
import type { ChatAttachment, ChatMessage } from '../../../types/assistant';

function att(id: string, extra: Partial<ChatAttachment> = {}): ChatAttachment {
  return { id, status: 'ready', storageUrl: `https://s/${id}.jpg`, ...extra };
}

function msg(id: string, attachments?: ChatAttachment[]): ChatMessage {
  return { id, role: 'user', text: 'here', createdAt: '', ...(attachments ? { attachments } : {}) };
}

describe('canAttachMore', () => {
  it('blocks a third photo on one message', () => {
    const res = canAttachMore({ pending: [{}, {}], messages: [] });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('per_message');
    expect(res.ok === false && res.message).toContain('Two photos at a time');
  });

  it('blocks a sixth in one chat', () => {
    const messages = [msg('m1', [att('a'), att('b')]), msg('m2', [att('c'), att('d')]), msg('m3', [att('e')])];
    const res = canAttachMore({ pending: [], messages });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('per_chat');
    expect(res.ok === false && res.message).toContain('five photos this chat');
  });

  it('counts a hi-res plan double', () => {
    expect(canAttachMore({ pending: [{ isPlan: true }], messages: [] }).ok).toBe(false);
    expect(canAttachMore({ pending: [], messages: [], isPlan: true }).ok).toBe(true);
    expect(canAttachMore({ pending: [{}], messages: [] }).ok).toBe(true);
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

  it('dedupes and caps at five', () => {
    const messages = [
      msg('m1', [att('a'), att('a'), att('b'), att('c')]),
      msg('m2', [att('d'), att('e'), att('f')]),
    ];
    const ids = collectQuotePhotos(messages).map((p) => p.id);
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
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
