// A tool call that throws mid-reply must answer the model, not end the
// session. The 00:15 UTC voice session of 3 Sep 2026 spoke three fragments
// that promised a draft, and then nothing arrived — the shape a dispatch
// rejection produced when it was routed to onError and the screen tore the
// session down.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatMessage } from '../../../types/assistant';

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(async () => ({ data: {} })),
}));

const dispatch = vi.hoisted(() => ({ dispatchToolCall: vi.fn() }));
vi.mock('../toolDispatcher', () => ({ dispatchToolCall: dispatch.dispatchToolCall }));

vi.mock('../liveSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../liveSession')>();
  return { ...actual, mintLiveToken: vi.fn() };
});

import { openVoiceSession, VoiceSessionCallbacks } from '../voiceSession';
import { mintLiveToken } from '../liveSession';

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

const history: ChatMessage[] = [{ id: 'u1', role: 'user', text: 'quote a switchboard', createdAt: '2026-09-03T00:15:00Z' }];

async function openSession(cb: VoiceSessionCallbacks) {
  const p = openVoiceSession(history, cb);
  await vi.advanceTimersByTimeAsync(0);
  const ws = MockWebSocket.instances[0];
  ws.onopen?.();
  ws.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) });
  await vi.advanceTimersByTimeAsync(0);
  return { ws, session: await p };
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as any);
  mintMock.mockReset();
  mintMock.mockResolvedValue({ token: 'tok-1', model: 'live-model' });
  dispatch.dispatchToolCall.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('tool calls on the Gemini voice path', () => {
  it('a thrown dispatch answers the model with an error and leaves the session open', async () => {
    dispatch.dispatchToolCall.mockRejectedValueOnce(new Error('boom'));
    const cb: VoiceSessionCallbacks = { onError: vi.fn(), onClose: vi.fn(), onProposal: vi.fn() };
    const { ws, session } = await openSession(cb);

    ws.onmessage?.({
      data: JSON.stringify({ toolCall: { functionCalls: [{ name: 'propose_draft_quote', id: 'c1', args: { jobName: 'Switchboard' } }] } }),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onClose).not.toHaveBeenCalled();
    expect(session.isOpen()).toBe(true);
    const reply = ws.frames().find((f) => f.toolResponse)!;
    expect(reply.toolResponse.functionResponses).toEqual([
      { name: 'propose_draft_quote', id: 'c1', response: { error: expect.stringContaining('propose_draft_quote failed: boom') } },
    ]);
  });

  it('one bad call in a batch does not take the good one with it', async () => {
    dispatch.dispatchToolCall
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ name: 'get_business_defaults', id: 'c2', response: { businessName: 'Leo Wright Electrical' } });
    const cb: VoiceSessionCallbacks = { onError: vi.fn(), onProposal: vi.fn() };
    const { ws } = await openSession(cb);

    ws.onmessage?.({
      data: JSON.stringify({
        toolCall: {
          functionCalls: [
            { name: 'find_customer', id: 'c1', args: { query: 'Sue' } },
            { name: 'get_business_defaults', id: 'c2', args: {} },
          ],
        },
      }),
    });
    await vi.advanceTimersByTimeAsync(0);

    const reply = ws.frames().find((f) => f.toolResponse)!;
    expect(reply.toolResponse.functionResponses.map((r: any) => r.id)).toEqual(['c1', 'c2']);
    expect(reply.toolResponse.functionResponses[1].response.businessName).toBe('Leo Wright Electrical');
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('a validated proposal still reaches the screen', async () => {
    const proposal = { id: 'p1', toolUseId: 'c1', createdAt: 'x', type: 'propose_draft_quote' } as any;
    dispatch.dispatchToolCall.mockResolvedValueOnce({ name: 'propose_draft_quote', id: 'c1', response: { ok: true, proposalId: 'p1' }, proposal });
    const cb: VoiceSessionCallbacks = { onError: vi.fn(), onProposal: vi.fn() };
    const { ws } = await openSession(cb);
    ws.onmessage?.({ data: JSON.stringify({ toolCall: { functionCalls: [{ name: 'propose_draft_quote', id: 'c1', args: {} }] } }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(cb.onProposal).toHaveBeenCalledWith(proposal);
  });
});
