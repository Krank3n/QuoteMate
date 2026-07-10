// Voice session lifecycle: setup timeout, auto-reconnect on socket drop,
// and the close/error funnel. Drives a mock WebSocket by hand — no network.

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

import {
  openVoiceSession,
  SETUP_TIMEOUT_MS,
  RECONNECT_DELAYS_MS,
  VoiceSessionCallbacks,
} from '../voiceSession';
import { mintLiveToken, LiveOfflineError, LiveQuotaError } from '../liveSession';

const mintMock = vi.mocked(mintLiveToken);

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  frames(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function msg(ws: MockWebSocket, payload: any) {
  ws.onmessage?.({ data: JSON.stringify(payload) });
}

// Drive a freshly-constructed socket through open + setupComplete.
async function completeHandshake(ws: MockWebSocket) {
  ws.onopen?.();
  msg(ws, { setupComplete: {} });
  await vi.advanceTimersByTimeAsync(0);
}

function makeCallbacks() {
  return {
    onReconnecting: vi.fn(),
    onReconnected: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    onTextDelta: vi.fn(),
  } satisfies VoiceSessionCallbacks;
}

const history: ChatMessage[] = [
  { id: 'u1', role: 'user', text: 'quote a fence', createdAt: '2026-01-01T00:00:00Z' },
];

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as any);
  mintMock.mockReset();
  mintMock.mockResolvedValue({ token: 'tok-1', model: 'live-model' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('openVoiceSession handshake', () => {
  it('resolves on setupComplete and sends setup + seeded history', async () => {
    const cb = makeCallbacks();
    const p = openVoiceSession(history, cb);
    await vi.advanceTimersByTimeAsync(0);
    const ws = MockWebSocket.instances[0];
    await completeHandshake(ws);
    const session = await p;

    expect(session.isOpen()).toBe(true);
    const frames = ws.frames();
    expect(frames[0].setup.model).toBe('models/live-model');
    expect(frames[1].clientContent.turns[0].parts[0].text).toBe('quote a fence');
    expect(frames[1].clientContent.turnComplete).toBe(false);
  });

  it('rejects with LiveOfflineError when setupComplete never arrives', async () => {
    const cb = makeCallbacks();
    const p = openVoiceSession(history, cb);
    const rejection = expect(p).rejects.toBeInstanceOf(LiveOfflineError);
    await vi.advanceTimersByTimeAsync(0);
    MockWebSocket.instances[0].onopen?.();
    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS + 1);
    await rejection;
    expect(MockWebSocket.instances[0].closed).toBe(true);
  });

  it('streams mic chunks as realtimeInput audio frames once the session is up', async () => {
    const cb = makeCallbacks();
    const p = openVoiceSession(history, cb, { reconnect: true });
    await vi.advanceTimersByTimeAsync(0);
    const ws = MockWebSocket.instances[0];
    await completeHandshake(ws);
    const session = await p;

    session.sendMicChunk('AAAA');
    const audioFrames = ws.frames().filter((f) => f.realtimeInput?.audio);
    expect(audioFrames).toHaveLength(1);
    expect(audioFrames[0].realtimeInput.audio.data).toBe('AAAA');
    expect(audioFrames[0].realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
  });
});

describe('drop without reconnect (default / PTT)', () => {
  it('fires onClose exactly once and no onError on a clean drop', async () => {
    const cb = makeCallbacks();
    const p = openVoiceSession(history, cb);
    await vi.advanceTimersByTimeAsync(0);
    const ws = MockWebSocket.instances[0];
    await completeHandshake(ws);
    await p;

    ws.onclose?.({ code: 1006 });
    expect(cb.onClose).toHaveBeenCalledTimes(1);
    expect(cb.onClose).toHaveBeenCalledWith(1006);
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onReconnecting).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('user close fires onClose once and ignores the trailing ws close event', async () => {
    const cb = makeCallbacks();
    const p = openVoiceSession(history, cb);
    await vi.advanceTimersByTimeAsync(0);
    const ws = MockWebSocket.instances[0];
    await completeHandshake(ws);
    const session = await p;

    session.close();
    ws.onclose?.({ code: 1000 });
    expect(session.isOpen()).toBe(false);
    expect(cb.onClose).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();
  });
});

describe('drop with reconnect (sticky)', () => {
  async function openSticky(cb: ReturnType<typeof makeCallbacks>, opts: any = {}) {
    const p = openVoiceSession(history, cb, { reconnect: true, ...opts });
    await vi.advanceTimersByTimeAsync(0);
    await completeHandshake(MockWebSocket.instances[0]);
    return p;
  }

  it('reopens a fresh socket after a drop and fires onReconnected, not onClose', async () => {
    const cb = makeCallbacks();
    const session = await openSticky(cb);

    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    expect(cb.onReconnecting).toHaveBeenCalledWith(1);

    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(MockWebSocket.instances).toHaveLength(2);
    await completeHandshake(MockWebSocket.instances[1]);

    expect(cb.onReconnected).toHaveBeenCalledTimes(1);
    expect(cb.onClose).not.toHaveBeenCalled();
    expect(cb.onError).not.toHaveBeenCalled();
    expect(session.isOpen()).toBe(true);

    // Traffic flows over the new socket.
    session.sendUserText('still there?');
    const ws2 = MockWebSocket.instances[1];
    const texts = ws2.frames().filter((f) => f.clientContent?.turnComplete === true);
    expect(texts[0].clientContent.turns[0].parts[0].text).toBe('still there?');
  });

  it('reseeds the reconnected socket from getSeedHistory', async () => {
    const cb = makeCallbacks();
    const newer: ChatMessage[] = [
      ...history,
      { id: 'a1', role: 'assistant', text: 'no worries', createdAt: '2026-01-01T00:01:00Z' },
    ];
    await openSticky(cb, { getSeedHistory: () => newer });

    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    const ws2 = MockWebSocket.instances[1];
    ws2.onopen?.();
    const seed = ws2.frames()[1].clientContent.turns;
    expect(seed).toHaveLength(2);
    expect(seed[1]).toEqual({ role: 'model', parts: [{ text: 'no worries' }] });
  });

  it('queues typed text during the outage and replays it after reconnect', async () => {
    const cb = makeCallbacks();
    const session = await openSticky(cb);

    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    session.sendUserText('typed while offline');

    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    const ws2 = MockWebSocket.instances[1];
    ws2.onopen?.();
    const texts = ws2.frames().filter((f) => f.clientContent?.turnComplete === true);
    expect(texts).toHaveLength(1);
    expect(texts[0].clientContent.turns[0].parts[0].text).toBe('typed while offline');
  });

  it('drops mic chunks during the outage instead of bursting stale audio', async () => {
    const cb = makeCallbacks();
    const session = await openSticky(cb);

    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    session.sendMicChunk('STALE');

    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    const ws2 = MockWebSocket.instances[1];
    await completeHandshake(ws2);
    expect(ws2.frames().filter((f) => f.realtimeInput?.audio)).toHaveLength(0);
  });

  it('gives up after all attempts fail and fires onError + onClose once', async () => {
    const cb = makeCallbacks();
    const session = await openSticky(cb);

    mintMock.mockRejectedValue(new LiveOfflineError('still offline'));
    MockWebSocket.instances[0].onclose?.({ code: 1006 });

    for (const delay of RECONNECT_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay);
    }

    expect(cb.onReconnecting).toHaveBeenCalledTimes(RECONNECT_DELAYS_MS.length);
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect((cb.onError.mock.calls[0][0] as Error).message).toBe('still offline');
    expect(cb.onClose).toHaveBeenCalledTimes(1);
    expect(session.isOpen()).toBe(false);
  });

  it('stops retrying immediately on a quota error', async () => {
    const cb = makeCallbacks();
    await openSticky(cb);

    mintMock.mockRejectedValue(new LiveQuotaError('daily limit'));
    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);

    expect(cb.onReconnecting).toHaveBeenCalledTimes(1);
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError.mock.calls[0][0]).toBeInstanceOf(LiveQuotaError);
    expect(cb.onClose).toHaveBeenCalledTimes(1);
    // No second socket was ever opened.
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('a user close during the backoff cancels the reconnect', async () => {
    const cb = makeCallbacks();
    const session = await openSticky(cb);

    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    expect(cb.onReconnecting).toHaveBeenCalledTimes(1);

    session.close();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0] + 1);

    expect(MockWebSocket.instances).toHaveLength(1); // no new socket
    expect(cb.onClose).toHaveBeenCalledTimes(1);
    expect(cb.onReconnected).not.toHaveBeenCalled();
  });

  it('a user close during an in-flight, then-failing attempt emits no further callbacks and closes the socket', async () => {
    const cb = makeCallbacks();
    const session = await openSticky(cb);

    // Drop → attempt 1 starts; backoff elapses; the mint resolves and the
    // attempt's socket is created and sits mid-handshake.
    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    expect(cb.onReconnecting).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(MockWebSocket.instances).toHaveLength(2);
    const ws2 = MockWebSocket.instances[1];

    // User taps stop while the handshake is in flight — the attempt's
    // socket must be closed immediately, not left until the setup timeout.
    session.close();
    expect(ws2.closed).toBe(true);
    expect(cb.onClose).toHaveBeenCalledTimes(1);

    // The aborted attempt now fails; the loop must NOT start attempt 2 —
    // a post-teardown onReconnecting would wedge the screen on 'connecting'.
    ws2.onclose?.({ code: 1000 });
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[1] + 1);
    expect(cb.onReconnecting).toHaveBeenCalledTimes(1);
    expect(cb.onReconnected).not.toHaveBeenCalled();
    expect(cb.onClose).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('recovers repeatedly — a second drop after a reconnect also reconnects', async () => {
    const cb = makeCallbacks();
    await openSticky(cb);

    MockWebSocket.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    await completeHandshake(MockWebSocket.instances[1]);
    expect(cb.onReconnected).toHaveBeenCalledTimes(1);

    MockWebSocket.instances[1].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    await completeHandshake(MockWebSocket.instances[2]);

    expect(cb.onReconnected).toHaveBeenCalledTimes(2);
    expect(cb.onClose).not.toHaveBeenCalled();
  });
});
