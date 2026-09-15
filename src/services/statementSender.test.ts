/**
 * The statement send call. The rate limiter answers with the generic "Too
 * many requests" every endpoint shares, so the mapping to something a tradie
 * can act on is the client's job and worth pinning — as is the device time
 * zone travelling with the request, since the period boundaries were worked
 * out in local time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  auth: { currentUser: { getIdToken: vi.fn(async () => 'id-token') } },
}));
vi.mock('../config/firebase', () => firebase);

import { sendAccountantStatement } from './statementSender';

const input = {
  fromMs: Date.UTC(2025, 6, 1),
  toMs: Date.UTC(2026, 6, 1),
  recipientEmail: 'books@accountant.com.au',
};

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('sendAccountantStatement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts the period, the recipient and the device time zone', async () => {
    const fetchMock = respondWith(200, { success: true, invoiceCount: 38, paymentCount: 27 });
    await sendAccountantStatement({ ...input, sendCopyToSelf: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/sendAccountantStatement');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      fromMs: input.fromMs,
      toMs: input.toMs,
      recipientEmail: 'books@accountant.com.au',
      sendCopyToSelf: true,
    });
    expect(body.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('turns a 429 into the hourly-limit message, not "Too many requests"', async () => {
    respondWith(429, { error: 'Too many requests. Please try again later.' });
    await expect(sendAccountantStatement(input)).rejects.toThrow(
      "You've sent a few statements already this hour. Try again later.",
    );
  });

  it('surfaces the server message on a 413', async () => {
    respondWith(413, { error: 'Statement is too large to email. Try a shorter period.' });
    await expect(sendAccountantStatement(input)).rejects.toThrow(
      'Statement is too large to email. Try a shorter period.',
    );
  });

  it('falls back to the status when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    })));
    await expect(sendAccountantStatement(input)).rejects.toThrow('Send failed (502)');
  });

  it('refuses to call the endpoint without a signed-in user', async () => {
    const fetchMock = respondWith(200, { success: true });
    firebase.auth.currentUser.getIdToken.mockResolvedValueOnce('' as any);
    await expect(sendAccountantStatement(input)).rejects.toThrow(
      'You need to be signed in to send a statement.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
