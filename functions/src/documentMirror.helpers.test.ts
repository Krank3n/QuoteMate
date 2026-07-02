import { describe, it, expect } from 'vitest';
import { preserveFirstSend } from './documentMirror';

describe('preserveFirstSend', () => {
  it('drops sentAt+sendMethod when existing.sentAt set', () => {
    const existing = { sentAt: 100, sendMethod: 'email' };
    const toWrite = { sentAt: 200, sendMethod: 'sms', stage: 'quote_sent', total: 500 };
    const result = preserveFirstSend(existing, toWrite);

    expect(result.sentAt).toBeUndefined();
    expect(result.sendMethod).toBeUndefined();
    // Everything else survives untouched.
    expect(result.stage).toBe('quote_sent');
    expect(result.total).toBe(500);
  });

  it('passes through when existing has none / existing null', () => {
    const toWrite = { sentAt: 200, sendMethod: 'sms', stage: 'quote_sent' };

    // Existing mirror without a sentAt yet — the first send should record.
    expect(preserveFirstSend({ stage: 'draft' }, toWrite)).toEqual(toWrite);
    // No existing mirror at all.
    expect(preserveFirstSend(null, toWrite)).toEqual(toWrite);
    expect(preserveFirstSend(undefined, toWrite)).toEqual(toWrite);
  });
});
