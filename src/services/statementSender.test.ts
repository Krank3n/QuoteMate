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
import { deviceTimeZone } from '../utils/statementPeriods';

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
    expect(body.timeZone).toBe(deviceTimeZone());
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

  it('hands back the counts the server actually emailed', async () => {
    respondWith(200, { success: true, invoiceCount: 38, paymentCount: 27 });
    await expect(sendAccountantStatement(input)).resolves.toEqual({
      invoiceCount: 38,
      paymentCount: 27,
    });
  });

  it('says the signal is the problem when the fetch never lands', async () => {
    // What a dropped socket actually throws: a bare TypeError on web, a
    // "Network request failed" on a phone. Neither is a sentence.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Network request failed');
    }));
    await expect(sendAccountantStatement(input)).rejects.toThrow(
      "Couldn't reach the server. Check your signal and try again.",
    );
  });

  it('tells the tradie to check their email rather than resend when it times out', async () => {
    // The backstop firing says nothing about the server, which finishes what
    // it started — so the message must not invite a second statement.
    vi.stubGlobal('fetch', vi.fn(async () => {
      const aborted: any = new Error('Aborted');
      aborted.name = 'AbortError';
      throw aborted;
    }));
    await expect(sendAccountantStatement(input)).rejects.toThrow(
      "That's taking longer than usual. Check your email in a minute before sending it again.",
    );
  });

  it('gives up on its own backstop rather than holding the socket open', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const aborted: any = new Error('Aborted');
            aborted.name = 'AbortError';
            reject(aborted);
          });
        });
      }));
      const pending = sendAccountantStatement(input);
      const settled = expect(pending).rejects.toThrow(/taking longer than usual/);
      await vi.advanceTimersByTimeAsync(60_000);
      await settled;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
