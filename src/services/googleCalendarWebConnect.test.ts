/**
 * Web transport for Google Calendar connect. Regression context: on web the
 * expo-auth-session flow could never return a refresh token (Google requires
 * the web client secret for the code exchange), so every web connect ended in
 * "Connect from the mobile app". These lock in the server-driven redirect.
 */
import { describe, it, expect, vi } from 'vitest';
import { startWebCalendarConnect } from './googleCalendarWebConnect';

function jsonResponse(body: unknown, status = 200, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
  } as unknown as Response;
}

const GOOGLE_URL =
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&response_type=code&state=abc';

describe('startWebCalendarConnect', () => {
  it('asks the server for a consent URL with the user\'s ID token and sends the tab there', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ authUrl: GOOGLE_URL, state: 'abc' }));
    const assign = vi.fn();

    await startWebCalendarConnect({
      getIdToken: async () => 'id-token-1',
      assign,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      functionsUrl: 'https://fn.example',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://fn.example/getGoogleCalendarAuthUrl');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer id-token-1');
    expect(assign).toHaveBeenCalledWith(GOOGLE_URL);
  });

  it('refuses to start when signed out and never hits the network', async () => {
    const fetchImpl = vi.fn();
    const assign = vi.fn();
    await expect(
      startWebCalendarConnect({
        getIdToken: async () => undefined,
        assign,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Sign in first/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('surfaces the server\'s error message instead of navigating', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Google Calendar integration not configured' }, 500));
    const assign = vi.fn();
    await expect(
      startWebCalendarConnect({ getIdToken: async () => 't', assign, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('Google Calendar integration not configured');
    expect(assign).not.toHaveBeenCalled();
  });

  it('explains an HTML error page (function not deployed / gateway error) instead of a JSON parse error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('<html>', 404, 'text/html'));
    await expect(
      startWebCalendarConnect({ getIdToken: async () => 't', assign: vi.fn(), fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/service unavailable \(HTTP 404\)/);
  });

  it('will only navigate to accounts.google.com — a tampered authUrl is not an open redirect', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ authUrl: 'https://evil.example/phish' }));
    const assign = vi.fn();
    await expect(
      startWebCalendarConnect({ getIdToken: async () => 't', assign, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/Could not open Google sign-in/);
    expect(assign).not.toHaveBeenCalled();
  });
});
