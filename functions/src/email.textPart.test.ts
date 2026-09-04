/**
 * The wire contract for the plain-text half of a multipart send.
 *
 * buildQuoteEmailText can be perfect and the customer still never sees it if
 * the string doesn't reach Brevo's `textContent` field, and that failure is
 * silent — Brevo happily accepts an HTML-only payload. So this pins the
 * payload, not the template (the template lives in documentEmail.test.ts,
 * which can't mock firebase-admin because it also renders the acceptance page
 * out of index.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { firestore, fetchMock, logSet } = vi.hoisted(() => {
  const logSet = vi.fn().mockResolvedValue(undefined);
  const bounceGet = vi.fn().mockResolvedValue({ docs: [] });
  const collection = () => ({
    add: vi.fn().mockResolvedValue({ id: 'emailLog1', set: logSet }),
    where: () => ({ select: () => ({ limit: () => ({ get: bounceGet }) }) }),
  });
  const firestore: any = () => ({ collection, doc: () => ({ get: bounceGet, set: logSet }) });
  firestore.FieldValue = { serverTimestamp: () => 'server-timestamp' };
  return { firestore, fetchMock: vi.fn(), logSet };
});

vi.mock('firebase-admin', () => ({ firestore }));
vi.mock('node-fetch', () => ({ default: fetchMock }));

import { sendEmail } from './email';

function brevoPayload(): any {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe('sendEmail — the plain-text part', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messageId: 'brevo-1' }) });
    process.env.BREVO_API_KEY = 'test-key';
  });

  it('forwards textContent to Brevo alongside the HTML', async () => {
    const sent = await sendEmail({
      to: 'sarah@bigpond.com.au',
      subject: 'Quotation from Hansen Fencing',
      htmlContent: '<p>Hi Sarah,</p>',
      textContent: 'Hi Sarah,\nhttps://quotemateapp.au/q?token=abc123',
      category: 'transactional',
      userId: 'test',
    });

    expect(sent).toBe(true);
    const payload = brevoPayload();
    expect(payload.htmlContent).toBe('<p>Hi Sarah,</p>');
    expect(payload.textContent).toBe('Hi Sarah,\nhttps://quotemateapp.au/q?token=abc123');
  });

  it('leaves the key off entirely when a caller sends HTML only', async () => {
    // Brevo derives its own text part in that case; sending an empty string
    // would give the customer a blank alternative instead.
    await sendEmail({
      to: 'sarah@bigpond.com.au',
      subject: 'Receipt',
      htmlContent: '<p>Paid</p>',
      category: 'transactional',
      userId: 'test',
    });

    expect('textContent' in brevoPayload()).toBe(false);
  });
});
