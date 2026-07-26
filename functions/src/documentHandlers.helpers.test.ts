import { describe, it, expect } from 'vitest';
import { buildSelfCopyBcc, sendMethodPatch, stageTransitionTimestamps } from './documentHandlers';

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
