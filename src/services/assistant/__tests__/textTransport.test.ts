// Text chat transport: per-request timeout, one retry on transient failures,
// and no retry on quota / rate-limit. Drives a mocked global fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { auth } from '../../../config/firebase';
import { sendAssistantTurn, stripLeakedToolJson } from '../../assistantService';
import {
  mintLiveToken,
  fetchWithTimeout,
  CHAT_TIMEOUT_MS,
  MINT_TIMEOUT_MS,
  LiveOfflineError,
  LiveQuotaError,
  LiveRateLimitError,
  __resetMintThrottle,
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
  vi.setSystemTime(0);
  fetchMock.mockReset();
  __resetMintThrottle();
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

  it('chat 429 throws LiveRateLimitError and does not retry', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(429));
    await expect(sendAssistantTurn({ history })).rejects.toBeInstanceOf(LiveRateLimitError);
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

  it('surfaces the server 429 as a LiveRateLimitError', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(429));
    await expect(mintLiveToken('voice')).rejects.toBeInstanceOf(LiveRateLimitError);
  });

  it('throttles a mint storm client-side before it can trip the server limit', async () => {
    const ok = { ok: true, status: 200, json: async () => ({ token: 'tok', model: 'm' }) } as unknown as Response;
    fetchMock.mockResolvedValue(ok);

    // The server allows 10/min; we self-limit at 8. Burn the window.
    for (let i = 0; i < 8; i++) await mintLiveToken('voice');
    expect(fetchMock).toHaveBeenCalledTimes(8);

    // The 9th mint inside the same window fails fast and never hits the network.
    await expect(mintLiveToken('voice')).rejects.toBeInstanceOf(LiveRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('lets mints through again once the rolling window elapses', async () => {
    const ok = { ok: true, status: 200, json: async () => ({ token: 'tok', model: 'm' }) } as unknown as Response;
    fetchMock.mockResolvedValue(ok);

    for (let i = 0; i < 8; i++) await mintLiveToken('voice');
    await expect(mintLiveToken('voice')).rejects.toBeInstanceOf(LiveRateLimitError);

    // Age the earlier mints out of the window, then a fresh mint is allowed.
    vi.setSystemTime(61_000);
    await expect(mintLiveToken('voice')).resolves.toEqual({ token: 'tok', model: 'm' });
    expect(fetchMock).toHaveBeenCalledTimes(9);
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

// A function-calling model sometimes *writes* a tool call instead of emitting
// one: the reply arrives as a fenced JSON blob of the arguments, with no
// functionCall part. One tradie got a chat bubble reading
// ```json { "query": "Hansen" } ``` mid-conversation. There's no tool name in
// the blob to re-dispatch, so it gets dropped rather than shown.
describe('stripLeakedToolJson', () => {
  it('drops a reply that is only a fenced JSON tool call', () => {
    expect(stripLeakedToolJson('```json\n{\n  "query": "Hansen"\n}\n```')).toBe('');
  });

  it('drops an unlabelled fenced JSON object', () => {
    expect(stripLeakedToolJson('```\n{"quoteId": "abc"}\n```')).toBe('');
  });

  it('drops a bare JSON object with no fence', () => {
    expect(stripLeakedToolJson('  {"query": "Hansen"}  ')).toBe('');
  });

  it('keeps a normal reply', () => {
    const text = "Drafted ABC's deck quote — tap Apply.";
    expect(stripLeakedToolJson(text)).toBe(text);
  });

  it('keeps prose that merely contains JSON', () => {
    const text = 'Set it to {"markup": 30} if you want — say the word.';
    expect(stripLeakedToolJson(text)).toBe(text);
  });

  it('keeps a fenced block that is not JSON', () => {
    const text = '```\nrun this on site\n```';
    expect(stripLeakedToolJson(text)).toBe(text);
  });

  it('keeps a JSON array (never a tool-call arg shape)', () => {
    const text = '[1, 2, 3]';
    expect(stripLeakedToolJson(text)).toBe(text);
  });

  it('leaves empty input alone', () => {
    expect(stripLeakedToolJson('')).toBe('');
  });
});

// Hidden "[context]" notes are written as user turns, so an apply-failed note
// followed by the tradie's next message would send two user turns back to
// back. Merge same-role neighbours rather than risk the model rejecting it.
describe('history assembly', () => {
  beforeEach(() => {
    vi.mocked(auth).currentUser = { getIdToken: async () => 'id-token' } as any;
  });

  it('merges consecutive same-role messages and keeps hidden context notes', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));

    await sendAssistantTurn({
      history: [
        { id: '1', role: 'user', text: 'mark it paid', createdAt: '' },
        { id: '2', role: 'assistant', text: 'tap Apply', createdAt: '' },
        { id: '3', role: 'assistant', text: '', createdAt: '', errorMessage: 'Invoice not found' },
        { id: '4', role: 'user', text: '[context] Apply FAILED', createdAt: '', hidden: true },
        { id: '5', role: 'user', text: 'why not?', createdAt: '' },
      ] as ChatMessage[],
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'mark it paid' }] },
      { role: 'model', parts: [{ text: 'tap Apply' }] },
      { role: 'user', parts: [{ text: '[context] Apply FAILED' }, { text: 'why not?' }] },
    ]);
  });
});
