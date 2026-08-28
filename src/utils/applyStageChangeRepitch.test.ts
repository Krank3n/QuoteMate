/**
 * Re-sending a quote the customer knocked back.
 *
 * The stage machine has always allowed quote_rejected → quote_sent, so the
 * new "Revise & Re-send" button moves the doc just fine. What made the button
 * decorative was the answer it dragged along: respondedAt is the field that
 * locks an acceptance token (both /respondToQuote and the review page's own
 * loader bail the moment it's set), so a re-pitched quote handed the customer
 * a fresh link that opened on "this quote has already been responded to".
 *
 * The server clears it when it mints the new link. On the SMS / share path
 * this save lands afterwards, so it has to clear it too or it puts the stale
 * value straight back.
 */
import { describe, it, expect, vi } from 'vitest';

import { applyStageChange, markDocumentSent } from './applyStageChange';
import { isStageDowngrade, canTransition } from '../../shared/document/stage';
import type { Document } from '../types/document';

function rejectedQuote(over: Partial<Document> = {}): Document {
  return {
    id: 'doc1',
    jobId: 'job1',
    type: 'quote',
    stage: 'quote_rejected',
    customerName: 'Sarah Thompson',
    total: 4_200,
    createdAt: 1_000,
    sentAt: 2_000,
    respondedAt: 9_000,
    respondedBy: 'Sarah Thompson',
    clientNotes: 'Too dear, going with the other mob.',
    materials: [],
    payments: [],
    ...over,
  } as unknown as Document;
}

function helpers() {
  const saveQuote = vi.fn(async () => {});
  return {
    saveQuote,
    saveInvoice: vi.fn(async () => {}),
    createInvoiceFromQuote: vi.fn(async () => ({} as any)),
    clearQuoteFields: vi.fn(async () => {}),
  };
}

describe('the re-pitch path is legal at all', () => {
  it('quote_rejected → quote_sent is an allowed transition, and not a downgrade', () => {
    // markDocumentSent no-ops on a downgrade — quote_rejected and quote_sent
    // share a rank precisely so a re-pitch isn't treated as going backwards.
    expect(canTransition('quote_rejected', 'quote_sent')).toBe(true);
    expect(isStageDowngrade('quote_rejected', 'quote_sent')).toBe(false);
  });
});

describe('applyStageChange — re-sending a rejected quote', () => {
  it('moves the quote back to sent', async () => {
    const h = helpers();
    await applyStageChange(rejectedQuote(), 'quote_sent', h);
    expect(h.saveQuote).toHaveBeenCalledTimes(1);
    expect(h.saveQuote.mock.calls[0][0]).toMatchObject({ status: 'sent' });
  });

  it('REGRESSION: drops the old response so the new link is answerable', async () => {
    const h = helpers();
    await applyStageChange(rejectedQuote(), 'quote_sent', h);
    const saved: any = h.saveQuote.mock.calls[0][0];
    expect(saved.respondedAt).toBeUndefined();
    expect(saved.respondedBy).toBeUndefined();
  });

  it('REGRESSION: deletes the stored fields, because a merge save cannot', async () => {
    // The assertion above only sees the object handed to saveQuote — and
    // saveQuote strips undefined and writes with merge:true, so an omitted
    // key leaves the STORED respondedAt exactly where it was. Passing that
    // test while the field survives in Firestore is precisely the shape of
    // this bug, so pin the explicit delete too.
    const h = helpers();
    await applyStageChange(rejectedQuote(), 'quote_sent', h);
    expect(h.clearQuoteFields).toHaveBeenCalledWith('doc1', ['respondedAt', 'respondedBy']);
  });

  it('does not delete anything on a send that is not a re-pitch', async () => {
    const h = helpers();
    await applyStageChange(
      rejectedQuote({ stage: 'draft', respondedAt: undefined, respondedBy: undefined }),
      'quote_sent',
      h,
    );
    expect(h.clearQuoteFields).not.toHaveBeenCalled();
  });

  it('still moves the stage when no clearQuoteFields helper is supplied', async () => {
    // The helper is optional — callers that never re-pitch don't pass it.
    const { clearQuoteFields, ...withoutClear } = helpers();
    await applyStageChange(rejectedQuote(), 'quote_sent', withoutClear);
    expect(withoutClear.saveQuote.mock.calls[0][0]).toMatchObject({ status: 'sent' });
  });

  it('keeps the note — it is the tradie record of why they said no', async () => {
    const h = helpers();
    await applyStageChange(rejectedQuote(), 'quote_sent', h);
    expect((h.saveQuote.mock.calls[0][0] as any).clientNotes)
      .toBe('Too dear, going with the other mob.');
  });

  it('does not rewrite the first-send stamp on the re-send', async () => {
    const h = helpers();
    await applyStageChange(rejectedQuote({ sentAt: 2_000 }), 'quote_sent', h);
    expect((h.saveQuote.mock.calls[0][0] as any).sentAt).toBe(2_000);
  });

  it('leaves an ordinary draft send alone', async () => {
    const h = helpers();
    await applyStageChange(
      rejectedQuote({ stage: 'draft', respondedAt: undefined, respondedBy: undefined, sentAt: undefined }),
      'quote_sent',
      h,
    );
    const saved: any = h.saveQuote.mock.calls[0][0];
    expect(saved.status).toBe('sent');
    expect(typeof saved.sentAt).toBe('number');
  });

  it('does not clear the answer on an accepted quote', async () => {
    // Marking a rejected quote approved (the un-reject edge) keeps the record
    // of when the customer responded — only a re-SEND resets the question.
    const h = helpers();
    await applyStageChange(rejectedQuote(), 'quote_accepted', h);
    expect((h.saveQuote.mock.calls[0][0] as any).respondedAt).toEqual(new Date(9_000));
    expect(h.clearQuoteFields).not.toHaveBeenCalled();
  });
});

describe('markDocumentSent — the SMS and share channels', () => {
  it('carries a rejected quote forward to sent rather than no-opping', async () => {
    const h = helpers();
    await markDocumentSent(rejectedQuote(), 'sms', h);
    expect(h.saveQuote).toHaveBeenCalledTimes(1);
    const saved: any = h.saveQuote.mock.calls[0][0];
    expect(saved.status).toBe('sent');
    expect(saved.respondedAt).toBeUndefined();
    expect(h.clearQuoteFields).toHaveBeenCalledWith('doc1', ['respondedAt', 'respondedBy']);
  });
});
