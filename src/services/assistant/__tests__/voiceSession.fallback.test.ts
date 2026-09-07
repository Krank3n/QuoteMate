/**
 * Falling back to Gemini when the nominated transport cannot serve.
 *
 * The outage this exists for: the OpenAI key ran out of credits while a 50%
 * rollout was live. Issuing a client secret costs nothing, so the mint kept
 * returning 200, the server kept nominating OpenAI, and every one of those
 * sessions died on its first frame. Half the tradies who pressed the mic got
 * "Voice mode is offline" until someone noticed.
 *
 * Gemini Live was healthy the entire time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatMessage } from '../../../types/assistant';

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(async () => ({ data: {} })),
}));
vi.mock('../toolDispatcher', () => ({
  dispatchToolCall: vi.fn(async () => ({ name: 'noop', id: '1', response: { ok: true } })),
}));
vi.mock('../liveSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../liveSession')>();
  return { ...actual, mintLiveToken: vi.fn() };
});
// The OpenAI transport is the thing under test's dependency, not the thing
// under test — what matters here is how openVoiceSession reacts to it.
vi.mock('../openAiVoiceSession', () => ({ openOpenAiVoiceSession: vi.fn() }));

import { openVoiceSession, VoiceSessionCallbacks } from '../voiceSession';
import {
  mintLiveToken, LiveRateLimitError, VoiceTransportUnavailableError,
} from '../liveSession';
import { openOpenAiVoiceSession } from '../openAiVoiceSession';

const mintMock = vi.mocked(mintLiveToken);
const openAiMock = vi.mocked(openOpenAiVoiceSession);

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;
  constructor(readonly url: string) { MockWebSocket.instances.push(this); }
  send(d: string) { if (this.closed) throw new Error('socket closed'); this.sent.push(d); }
  close() { this.closed = true; }
}

const history: ChatMessage[] = [
  { id: 'u1', role: 'user', text: 'quote a fence', createdAt: '2026-01-01T00:00:00Z' },
];
const callbacks = (): VoiceSessionCallbacks => ({ onError: vi.fn(), onClose: vi.fn() });

const OPENAI_MINT = { provider: 'openai', token: 'oa-tok', model: 'gpt-realtime-2.1', voice: 'cedar' } as any;
const GEMINI_MINT = { token: 'gem-tok', model: 'gemini-live' } as any;

/** Let the Gemini socket finish its handshake. */
async function completeGeminiHandshake() {
  await vi.advanceTimersByTimeAsync(0);
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  ws.onopen?.();
  ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) });
  await vi.advanceTimersByTimeAsync(0);
  return ws;
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as any);
  mintMock.mockReset();
  openAiMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a nominated transport that cannot serve', () => {
  const nominateOpenAiThenGemini = () => {
    mintMock.mockResolvedValueOnce(OPENAI_MINT).mockResolvedValueOnce(GEMINI_MINT);
    openAiMock.mockRejectedValue(
      new VoiceTransportUnavailableError('You have no credits remaining.', 'openai'),
    );
  };

  it('gives the tradie a working Gemini session instead of an error', async () => {
    nominateOpenAiThenGemini();
    const p = openVoiceSession(history, callbacks());
    await completeGeminiHandshake();
    await expect(p).resolves.toBeTruthy();
  });

  it('re-mints declaring it can no longer open the failed transport', async () => {
    // Declaring fewer capabilities is what routes the SERVER's own decision to
    // Gemini — no second override path, and no server change.
    nominateOpenAiThenGemini();
    const p = openVoiceSession(history, callbacks());
    await completeGeminiHandshake();
    await p;
    expect(mintMock).toHaveBeenCalledTimes(2);
    expect(mintMock.mock.calls[0]).toEqual(['voice']);
    expect(mintMock.mock.calls[1]).toEqual(['voice', { excludeProviders: ['openai'] }]);
  });

  it('stamps the transport that actually spoke, not the one that was nominated', async () => {
    // The stamp is how a fallback shows up in /admin/conversations. Reporting
    // openai here would quietly poison the A/B with sessions OpenAI never had.
    nominateOpenAiThenGemini();
    const p = openVoiceSession(history, callbacks());
    await completeGeminiHandshake();
    const session = await p;
    expect((session as any).provider).toBe('gemini');
    expect((session as any).model).toBe('gemini-live');
  });

  it('never shows the tradie an error for the transport that was abandoned', async () => {
    nominateOpenAiThenGemini();
    const cb = callbacks();
    const p = openVoiceSession(history, cb);
    await completeGeminiHandshake();
    await p;
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('falls back once, not in a loop, when Gemini fails too', async () => {
    // A retry loop here would burn the 10/min mint ceiling in seconds.
    mintMock.mockResolvedValueOnce(OPENAI_MINT).mockResolvedValueOnce(OPENAI_MINT);
    openAiMock.mockRejectedValue(new VoiceTransportUnavailableError('still broke', 'openai'));
    await expect(openVoiceSession(history, callbacks())).rejects.toThrow('still broke');
    expect(mintMock).toHaveBeenCalledTimes(2);
  });
});

describe('failures that are NOT the provider', () => {
  it('does not burn a second mint on a rate limit', async () => {
    // The tradie is being throttled; Gemini would throttle them too, and the
    // retry itself is another mint against the ceiling they just hit.
    mintMock.mockRejectedValueOnce(new LiveRateLimitError('Whoa — too many requests.'));
    await expect(openVoiceSession(history, callbacks())).rejects.toBeInstanceOf(LiveRateLimitError);
    expect(mintMock).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when the transport fails for an ordinary reason', async () => {
    // Patchy reception is the tradie's connection, not a dead provider.
    mintMock.mockResolvedValueOnce(OPENAI_MINT);
    openAiMock.mockRejectedValue(new Error('Connection timed out'));
    await expect(openVoiceSession(history, callbacks())).rejects.toThrow('Connection timed out');
    expect(mintMock).toHaveBeenCalledTimes(1);
  });
});
