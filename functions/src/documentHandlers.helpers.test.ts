import { describe, it, expect } from 'vitest';
import {
  buildSelfCopyBcc,
  sendMethodPatch,
  stageTransitionTimestamps,
  isRepitchSend,
  REPITCH_RESPONSE_RESET,
} from './documentHandlers';

describe('sendMethodPatch', () => {
  it('returns {sendMethod} only on a sent transition', () => {
    const transitions = stageTransitionTimestamps('draft', 'quote_sent');
    expect(transitions.sentAt).toBeTypeOf('number');
    expect(sendMethodPatch(transitions, 'email')).toEqual({ sendMethod: 'email' });

    const invoiceTransitions = stageTransitionTimestamps('quote_accepted', 'invoice_sent');
    expect(invoiceTransitions.sentAt).toBeTypeOf('number');
    expect(sendMethodPatch(invoiceTransitions, 'sms')).toEqual({ sendMethod: 'sms' });
  });

  it('returns {} on a self-transition', () => {
    // Self-transition yields no sentAt, so nothing to pair a method with.
    const transitions = stageTransitionTimestamps('quote_sent', 'quote_sent');
    expect(transitions.sentAt).toBeUndefined();
    expect(sendMethodPatch(transitions, 'email')).toEqual({});
  });

  it('returns {} for a non-sent target', () => {
    const transitions = stageTransitionTimestamps('quote_sent', 'quote_accepted');
    expect(transitions.sentAt).toBeUndefined();
    expect(sendMethodPatch(transitions, 'email')).toEqual({});
  });

  it('returns {} when no sendMethod supplied on a sent transition', () => {
    const transitions = stageTransitionTimestamps('draft', 'quote_sent');
    expect(sendMethodPatch(transitions, undefined)).toEqual({});
  });
});

describe('buildSelfCopyBcc', () => {
  const base = { sendCopyToSelf: true, isTestSend: false, selfEmail: 'tradie@example.au', recipientEmail: 'client@example.au' };

  it('BCCs the tradie on a real send with the toggle on', () => {
    expect(buildSelfCopyBcc(base)).toEqual([{ email: 'tradie@example.au' }]);
  });

  it('returns undefined when the toggle is off', () => {
    expect(buildSelfCopyBcc({ ...base, sendCopyToSelf: false })).toBeUndefined();
    expect(buildSelfCopyBcc({ ...base, sendCopyToSelf: undefined })).toBeUndefined();
  });

  it('returns undefined on test sends (they already go to the tradie)', () => {
    expect(buildSelfCopyBcc({ ...base, isTestSend: true })).toBeUndefined();
  });

  it('returns undefined when no account email could be resolved', () => {
    expect(buildSelfCopyBcc({ ...base, selfEmail: null })).toBeUndefined();
    expect(buildSelfCopyBcc({ ...base, selfEmail: '' })).toBeUndefined();
  });

  it('skips the BCC when the tradie is already the recipient (case/whitespace-insensitive)', () => {
    expect(buildSelfCopyBcc({ ...base, recipientEmail: 'tradie@example.au' })).toBeUndefined();
    expect(buildSelfCopyBcc({ ...base, recipientEmail: '  Tradie@Example.AU ' })).toBeUndefined();
  });
});

/**
 * Re-sending a quote the customer knocked back.
 *
 * respondedAt is what locks an acceptance token: /respondToQuote and the
 * review page's own loader both bail the moment it's set. So minting a fresh
 * link over an old rejection handed the customer a page saying "this quote
 * has already been responded to" — the re-pitch the stage machine has always
 * allowed could never actually be answered.
 */
describe('isRepitchSend', () => {
  it('recognises a rejection from the unified document stage', () => {
    expect(isRepitchSend({ stage: 'quote_rejected' })).toBe(true);
  });

  it('recognises one from the legacy quote status, which the SMS path carries', () => {
    expect(isRepitchSend({ status: 'rejected' })).toBe(true);
  });

  it('is false for every stage the customer has not said no on', () => {
    expect(isRepitchSend({ stage: 'draft' })).toBe(false);
    expect(isRepitchSend({ stage: 'quote_sent' })).toBe(false);
    // The important one: re-sending an accepted quote (a PDF the customer
    // misplaced) must not reopen it for a decline.
    expect(isRepitchSend({ stage: 'quote_accepted', status: 'accepted' })).toBe(false);
    expect(isRepitchSend({})).toBe(false);
  });
});

describe('REPITCH_RESPONSE_RESET', () => {
  it('retires the previous answer and nothing else', () => {
    expect(REPITCH_RESPONSE_RESET).toEqual({ respondedAt: null, respondedBy: null });
    // clientNotes is NOT in here — it's the tradie's record of why they said
    // no, not part of the question being asked again.
    expect(Object.keys(REPITCH_RESPONSE_RESET)).not.toContain('clientNotes');
  });

  it('clears with null rather than a delete sentinel', () => {
    // This patch also rides through setDocumentStage's stripUndefined, which
    // recurses into objects — a FieldValue.delete() would come out the far
    // side as a plain {} and write garbage. A primitive can't be shredded.
    expect(REPITCH_RESPONSE_RESET.respondedAt).toBeNull();
    expect(REPITCH_RESPONSE_RESET.respondedBy).toBeNull();
  });
});
