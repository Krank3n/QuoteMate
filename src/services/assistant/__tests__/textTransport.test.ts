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
import type { ChatAttachment, ChatMessage } from '../../../types/assistant';
import { setPendingProposalProbe } from '../pendingProposalGate';

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

// Photos ride ONCE, on the turn they were attached. The tool loop re-POSTs the
// whole contents array up to 8 times per turn, so replaying an image across the
// 20-message window would multiply that again for a picture the model already
// described in words.
describe('attachment transport', () => {
  const photo = (id: string): ChatAttachment => ({
    id,
    status: 'ready',
    localUri: `file:///${id}.jpg`,
    storageUrl: `https://s/${id}.jpg`,
  });
  const inline = { mimeType: 'image/jpeg', data: 'AAAA' };
  const resolveAttachment = async () => inline;

  function contentsOf(): any[] {
    return JSON.parse((fetchMock.mock.calls[0][1] as any).body).contents;
  }

  beforeEach(() => {
    vi.mocked(auth).currentUser = { getIdToken: async () => 'id-token' } as any;
  });

  it('caps images per request, not per message, across a split user run', async () => {
    // A hidden [context] note (or an error bubble) splits the trailing user
    // run into two messages. Resetting the slot budget per message would put
    // four photos on one request and re-POST them on every tool hop.
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({
      history: [
        { id: '1', role: 'user', text: 'these two', createdAt: '', attachments: [photo('p1'), photo('p2')] },
        { id: '2', role: 'user', text: 'and these', createdAt: '', attachments: [photo('p3'), photo('p4')] },
      ],
      resolveAttachment,
    });
    const parts = contentsOf().flatMap((c: any) => c.parts);
    expect(parts.filter((p: any) => p.inlineData)).toHaveLength(2);
  });

  it('sends an image-only user turn as a single inlineData part', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({
      history: [{ id: '1', role: 'user', text: '', createdAt: '', attachments: [photo('p1')] }],
      resolveAttachment,
    });
    expect(contentsOf()).toEqual([{ role: 'user', parts: [{ inlineData: inline }] }]);
  });

  it('sends inlineData alongside caption text, image first', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({
      history: [
        { id: '1', role: 'user', text: 'how much to replace this?', createdAt: '', attachments: [photo('p1')] },
      ],
      resolveAttachment,
    });
    expect(contentsOf()).toEqual([
      { role: 'user', parts: [{ inlineData: inline }, { text: 'how much to replace this?' }] },
    ]);
  });

  it('replays an older photo turn as text only', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({
      history: [
        { id: '1', role: 'user', text: 'have a look', createdAt: '', attachments: [photo('p1')] },
        { id: '2', role: 'assistant', text: 'timber paling, looks rooted', createdAt: '' },
        { id: '3', role: 'user', text: 'price it up', createdAt: '' },
      ],
      resolveAttachment,
    });
    expect(contentsOf()).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'have a look' },
          { text: '[1 photo(s) attached to this message earlier in the chat]' },
        ],
      },
      { role: 'model', parts: [{ text: 'timber paling, looks rooted' }] },
      { role: 'user', parts: [{ text: 'price it up' }] },
    ]);
  });

  it('merges an attachment-bearing turn into the preceding user turn', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({
      history: [
        { id: '1', role: 'user', text: '[context] Draft applied', createdAt: '', hidden: true },
        { id: '2', role: 'user', text: '', createdAt: '', attachments: [photo('p1')] },
      ],
      resolveAttachment,
    });
    expect(contentsOf()).toEqual([
      { role: 'user', parts: [{ text: '[context] Draft applied' }, { inlineData: inline }] },
    ]);
  });

  it('still drops empty-text bubbles with no attachments', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({
      history: [
        { id: '1', role: 'assistant', text: '', createdAt: '', inlineQuoteId: 'q1' },
        { id: '2', role: 'user', text: 'ta', createdAt: '' },
      ],
      resolveAttachment,
    });
    expect(contentsOf()).toEqual([{ role: 'user', parts: [{ text: 'ta' }] }]);
  });

  it('never mentions a photo whose upload failed', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({
      history: [
        {
          id: '1',
          role: 'user',
          text: 'this one',
          createdAt: '',
          attachments: [{ ...photo('p1'), status: 'failed' }],
        },
      ],
      resolveAttachment,
    });
    // It never reached Mate and never will — claiming it was "attached
    // earlier" would have the model discussing a photo that doesn't exist.
    expect(contentsOf()).toEqual([{ role: 'user', parts: [{ text: 'this one' }] }]);
  });

  it('tells the model a photo it could not read never arrived', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({
      history: [
        { id: '1', role: 'user', text: 'how much?', createdAt: '', attachments: [photo('p1')] },
      ],
      // Bytes unreadable — an oversized shot, or a file that's gone.
      resolveAttachment: async () => null,
    });
    const parts = contentsOf()[0].parts;
    expect(parts[0]).toEqual({ text: 'how much?' });
    expect(parts[1].text).toContain('could not be read');
    expect(parts[1].text).toContain('you have NOT seen them');
  });

  it('refuses to POST an empty contents array', async () => {
    // A caption-less bubble whose only photo failed to upload used to build an
    // empty request, and the server's own "contents required." 400 landed in
    // the chat as if Mate had said it.
    await expect(
      sendAssistantTurn({
        history: [
          {
            id: '1',
            role: 'user',
            text: '',
            createdAt: '',
            attachments: [{ ...photo('p1'), status: 'failed' }],
          },
        ],
        resolveAttachment,
      }),
    ).rejects.toThrow(/give me a line to go on/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the existing text-only contents shape unchanged', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({ history, resolveAttachment });
    expect(contentsOf()).toEqual([{ role: 'user', parts: [{ text: 'price up a fence' }] }]);
  });
});

// The loading line is built from the tool calls the model actually makes, so
// the callback has to fire before they're dispatched — never from model
// reasoning, which we don't surface at all.
describe('tool-call reporting', () => {
  function toolCallResponse(name: string, args: Record<string, unknown>) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        parts: [{ functionCall: { name, id: `${name}-1`, args } }],
        model: 'gemini-test',
      }),
    } as unknown as Response;
  }

  beforeEach(() => {
    vi.mocked(auth).currentUser = { getIdToken: async () => 'id-token' } as any;
  });

  it('reports each tool call with its name and args', async () => {
    fetchMock
      .mockResolvedValueOnce(toolCallResponse('find_customer', { name: 'Gigar' }))
      .mockResolvedValueOnce(okChatResponse('found them'));

    const seen: Array<Array<{ name: string }>> = [];
    await sendAssistantTurn({
      history: [{ id: '1', role: 'user', text: 'quote a fence for Gigar', createdAt: '' }],
      onToolCalls: (calls) => seen.push(calls),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0][0].name).toBe('find_customer');
    expect(seen[0][0].args).toEqual({ name: 'Gigar' });
  });

  it('does not fire on a plain text turn', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('no tools needed'));
    const onToolCalls = vi.fn();
    await sendAssistantTurn({
      history: [{ id: '1', role: 'user', text: 'g\'day', createdAt: '' }],
      onToolCalls,
    });
    expect(onToolCalls).not.toHaveBeenCalled();
  });
});

// "Kicking off a reprice on those.Card's up" reached a real screen — hop 1's
// text and hop 2's were butted together with no separator. The server-side
// adapter coalesces blocks within one reply; only the client sees across hops.
describe('cross-hop text joining', () => {
  it('separates text from different hops with a paragraph break', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          parts: [
            { text: 'Kicking off a reprice on those.' },
            { functionCall: { name: 'propose_reprice', id: 'r1', args: { quoteId: 'q1' } } },
          ],
          model: 'gemini-test',
        }),
      } as unknown as Response)
      .mockResolvedValueOnce(okChatResponse("Card's up — hit re-price."));

    const res = await sendAssistantTurn({ history });
    expect(res.text).toBe("Kicking off a reprice on those.\n\nCard's up — hit re-price.");
  });

  it('adds no break within a single hop', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('One clean reply.'));
    const res = await sendAssistantTurn({ history });
    expect(res.text).toBe('One clean reply.');
  });
});

// Typed confirmations (25 Aug 2026): the control tools used to exist only in
// voice, so a typed "go ahead" dead-ended with Mate pointing at the button.
describe('typed confirmations (control tools)', () => {
  beforeEach(() => {
    vi.mocked(auth).currentUser = { getIdToken: async () => 'id-token' } as any;
  });
  afterEach(() => setPendingProposalProbe(null));

  function toolCallResponse(name: string, args: any = {}) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        parts: [{ functionCall: { name, args, id: 'fc1' } }],
        model: 'claude-test',
      }),
    } as unknown as Response;
  }

  it('offers the control tools to the text model', async () => {
    fetchMock.mockResolvedValueOnce(okChatResponse('righto'));
    await sendAssistantTurn({ history });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    const names = body.tools[0].functionDeclarations.map((d: any) => d.name);
    expect(names).toContain('apply_pending_proposal');
    expect(names).toContain('cancel_pending_proposal');
  });

  it('a typed "yes" pins the waiting card and surfaces a controlAction', async () => {
    setPendingProposalProbe(() => ({ messageId: 'm9', proposalId: 'prop_9' }));
    fetchMock
      .mockResolvedValueOnce(toolCallResponse('apply_pending_proposal'))
      .mockResolvedValueOnce(okChatResponse('Done — pricing it up now.'));
    const res = await sendAssistantTurn({ history });
    expect(res.controlActions).toEqual([
      { decision: 'apply', messageId: 'm9', proposalId: 'prop_9' },
    ]);
    // The model was told ok inside the turn.
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as any).body);
    const fr = secondBody.contents.at(-1).parts[0].functionResponse;
    expect(fr.response).toEqual({ ok: true });
  });

  it('a typed "nah" surfaces a cancel controlAction', async () => {
    setPendingProposalProbe(() => ({ messageId: 'm9', proposalId: 'prop_9' }));
    fetchMock
      .mockResolvedValueOnce(toolCallResponse('cancel_pending_proposal'))
      .mockResolvedValueOnce(okChatResponse('No worries, binned it.'));
    const res = await sendAssistantTurn({ history });
    expect(res.controlActions).toEqual([
      { decision: 'cancel', messageId: 'm9', proposalId: 'prop_9' },
    ]);
  });

  it('tells the model in-turn when no card is waiting', async () => {
    setPendingProposalProbe(() => null);
    fetchMock
      .mockResolvedValueOnce(toolCallResponse('apply_pending_proposal'))
      .mockResolvedValueOnce(okChatResponse('Nothing waiting, mate.'));
    const res = await sendAssistantTurn({ history });
    expect(res.controlActions).toEqual([]);
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as any).body);
    const fr = secondBody.contents.at(-1).parts[0].functionResponse;
    expect(fr.response.error).toBe('No card is waiting to confirm.');
  });

  it('dedupes a repeated apply across hops — one card, one apply', async () => {
    setPendingProposalProbe(() => ({ messageId: 'm9', proposalId: 'prop_9' }));
    fetchMock
      .mockResolvedValueOnce(toolCallResponse('apply_pending_proposal'))
      .mockResolvedValueOnce(toolCallResponse('apply_pending_proposal'))
      .mockResolvedValueOnce(okChatResponse('Done.'));
    const res = await sendAssistantTurn({ history });
    expect(res.controlActions).toHaveLength(1);
  });
});
