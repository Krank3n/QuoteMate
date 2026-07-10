// Text chat transport: per-request timeout, one retry on transient failures,
// and no retry on quota / rate-limit. Drives a mocked global fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { auth } from '../../../config/firebase';
import { sendAssistantTurn } from '../../assistantService';
import {
  mintLiveToken,
  fetchWithTimeout,
  CHAT_TIMEOUT_MS,
  MINT_TIMEOUT_MS,
  LiveOfflineError,
  LiveQuotaError,
} from '../liveSession';
import type { ChatMessage } from '../../../types/assistant';

const fetchMock = vi.fn();

function okChatResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ parts: [{ text }], model: 'gemini-test' }),
  } as unknown as Response;
}

function errorResponse(status: number, body: any = {}) {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

// A fetch that never resolves until its abort signal fires.
function hangingFetch(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')),
    );
  });
}

const history: ChatMessage[] = [
  { id: 'u1', role: 'user', text: 'price up a fence', createdAt: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  (auth as any).currentUser = { uid: 'test-uid', getIdToken: async () => 'id-tok' };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('sendAssistantTurn transport', () => {
  it('resolves a plain text turn with a single POST', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse("g'day"));
    const deltas: string[] = [];
    const res = await sendAssistantTurn({ history, onTextDelta: (d) => deltas.push(d) });
    expect(res.text).toBe("g'day");
    expect(deltas).toEqual(["g'day"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.countTurn).toBe(true);
  });

  it('retries once after a network failure and succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(okChatResponse('back online'));
    const p = sendAssistantTurn({ history });
    await vi.advanceTimersByTimeAsync(1000); // ride past the retry delay
    const res = await p;
    expect(res.text).toBe('back online');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once after a transient 503 and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(okChatResponse('recovered'));
    const p = sendAssistantTurn({ history });
    await vi.advanceTimersByTimeAsync(1000);
    const res = await p;
    expect(res.text).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails with LiveOfflineError when both attempts fail', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const p = sendAssistantTurn({ history });
    const rejection = expect(p).rejects.toBeInstanceOf(LiveOfflineError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a hung request at the timeout and retries', async () => {
    fetchMock
      .mockImplementationOnce(hangingFetch)
      .mockResolvedValueOnce(okChatResponse('slow but fine'));
    const p = sendAssistantTurn({ history });
    await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS + 1000);
    const res = await p;
    expect(res.text).toBe('slow but fine');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the timeout message when every attempt hangs', async () => {
    fetchMock.mockImplementation(hangingFetch);
    const p = sendAssistantTurn({ history });
    const rejection = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(2 * CHAT_TIMEOUT_MS + 2000);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 429 rate limit', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(429));
    await expect(sendAssistantTurn({ history })).rejects.toBeInstanceOf(LiveOfflineError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a 402 quota error and surfaces LiveQuotaError', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(402, { error: 'daily limit' }));
    await expect(sendAssistantTurn({ history })).rejects.toBeInstanceOf(LiveQuotaError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('mintLiveToken', () => {
  it('returns the minted token on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ token: 'tok', model: 'live-model' }),
    } as unknown as Response);
    const minted = await mintLiveToken('voice');
    expect(minted).toEqual({ token: 'tok', model: 'live-model' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out a hung mint instead of stalling forever, without retrying', async () => {
    fetchMock.mockImplementation(hangingFetch);
    const p = mintLiveToken('voice');
    const rejection = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(MINT_TIMEOUT_MS + 1000);
    await rejection;
    // The voice reconnect loop owns retries — the mint itself must not.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithTimeout', () => {
  it('passes through a non-timeout failure unchanged', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('boom'));
    await expect(fetchWithTimeout('https://x', {}, 5000)).rejects.toThrow('boom');
  });

  it('clears its timer on success so nothing aborts later', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('fine'));
    const res = await fetchWithTimeout('https://x', {}, 5000);
    expect(res.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000); // no unhandled abort
  });
});
