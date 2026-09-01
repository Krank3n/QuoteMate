/**
 * The ElevenLabs client-tool calling convention, pinned.
 *
 * Three things here are load-bearing and all fail quietly if they regress:
 *
 *  • The wire result is a STRING. A handler resolving to undefined leaves the
 *    turn hanging until response_timeout_secs, which reads to the tradie as
 *    Mate going silent mid-sentence.
 *  • Handlers RESOLVE on failure, never reject. The SDK turns a rejection into
 *    is_error, which surfaces via onError and risks a user-visible error bubble
 *    for a recoverable tool miss. Mate's prompt already treats { error } as a
 *    normal result on the text path.
 *  • show_quote and the control tools must return the SCREEN's verdict, not the
 *    dispatcher's optimistic ok. "It's on your screen" when it isn't is,
 *    per the system prompt, the one thing that makes Mate useless.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dispatchToolCall = vi.fn();
vi.mock('../toolDispatcher', () => ({ dispatchToolCall: (c: any) => dispatchToolCall(c) }));

import { buildClientTools, packToolResult, MAX_TOOL_RESULT_CHARS } from '../clientTools';
import { ALL_TOOL_DECLARATIONS } from '../toolSchemas';

const parse = (s: string) => JSON.parse(s);

beforeEach(() => {
  dispatchToolCall.mockReset();
  dispatchToolCall.mockResolvedValue({ name: 'x', id: '1', response: { ok: true } });
});

describe('buildClientTools', () => {
  it('registers a handler for every declared tool, so the agent can never call one that is missing', () => {
    const tools = buildClientTools({});
    expect(Object.keys(tools).sort()).toEqual(ALL_TOOL_DECLARATIONS.map((d) => d.name).sort());
  });

  it('returns read-tool results as a JSON string', async () => {
    dispatchToolCall.mockResolvedValue({
      name: 'find_customer', id: '1',
      response: { matches: [{ contactId: 'c1', name: 'Bob' }], confidence: 0.9 },
    });
    const out = await buildClientTools({}).find_customer({ query: 'bob' });
    expect(typeof out).toBe('string');
    expect(parse(out).matches[0].name).toBe('Bob');
  });

  it('emits the proposal card and returns the dispatcher ok/proposalId', async () => {
    const proposal = { id: 'p1', type: 'propose_draft_quote' } as any;
    dispatchToolCall.mockResolvedValue({
      name: 'propose_draft_quote', id: '1',
      response: { ok: true, proposalId: 'p1' }, proposal,
    });
    const onProposal = vi.fn();
    const out = await buildClientTools({ onProposal }).propose_draft_quote({ jobName: 'Fence' });
    expect(onProposal).toHaveBeenCalledWith(proposal);
    expect(parse(out)).toMatchObject({ ok: true, proposalId: 'p1' });
  });

  it('returns the screen error when show_quote cannot render the id', async () => {
    dispatchToolCall.mockResolvedValue({
      name: 'show_quote', id: '1',
      response: { ok: true }, view: { kind: 'show_quote', quoteId: 'QU-1' },
    });
    const onShowQuote = vi.fn(() => ({ ok: false, error: "Couldn't find that quote." }));
    const out = await buildClientTools({ onShowQuote }).show_quote({ quoteId: 'QU-1' });
    expect(onShowQuote).toHaveBeenCalledWith('QU-1');
    // Not the dispatcher's { ok: true } — the screen gets the last word.
    expect(parse(out)).toEqual({ ok: false, error: "Couldn't find that quote." });
  });

  it('routes apply_pending_proposal to the screen without touching the dispatcher', async () => {
    const onControlAction = vi.fn(() => ({ ok: true }));
    const out = await buildClientTools({ onControlAction }).apply_pending_proposal({});
    expect(onControlAction).toHaveBeenCalledWith('apply', undefined);
    expect(dispatchToolCall).not.toHaveBeenCalled();
    expect(parse(out)).toEqual({ ok: true });
  });

  it('passes an explicit proposalId through on cancel', async () => {
    const onControlAction = vi.fn(() => ({ ok: true }));
    await buildClientTools({ onControlAction }).cancel_pending_proposal({ proposalId: 'p9' });
    expect(onControlAction).toHaveBeenCalledWith('cancel', 'p9');
  });

  it('tells the model no card was waiting rather than claiming success', async () => {
    const onControlAction = vi.fn(() => ({ ok: false, error: 'No card is waiting.' }));
    const out = await buildClientTools({ onControlAction }).apply_pending_proposal({});
    expect(parse(out)).toEqual({ ok: false, error: 'No card is waiting.' });
  });

  it('reports a missing control callback as an error instead of a silent ok', async () => {
    const out = await buildClientTools({}).apply_pending_proposal({});
    expect(parse(out).ok).toBe(false);
  });

  it('resolves with a JSON error string when a tool throws, never rejecting', async () => {
    dispatchToolCall.mockRejectedValue(new Error('Firestore unavailable'));
    const out = await buildClientTools({}).get_quote({ quoteId: 'QU-1' });
    expect(typeof out).toBe('string');
    expect(parse(out)).toEqual({ error: 'Firestore unavailable' });
  });

  it('resolves with a string even when the dispatcher returns no response body', async () => {
    dispatchToolCall.mockResolvedValue({ name: 'get_quote', id: '1', response: undefined });
    const out = await buildClientTools({}).get_quote({ quoteId: 'QU-1' });
    expect(typeof out).toBe('string');
    expect(parse(out)).toEqual({ ok: true });
  });

  it('tolerates being called with no arguments at all', async () => {
    await buildClientTools({}).get_business_defaults(undefined);
    expect(dispatchToolCall).toHaveBeenCalledWith(expect.objectContaining({ args: {} }));
  });
});

describe('packToolResult', () => {
  it('passes a short object through as JSON', () => {
    expect(packToolResult({ ok: true })).toBe('{"ok":true}');
  });

  it('leaves an already-string result alone', () => {
    expect(packToolResult('plain')).toBe('plain');
  });

  it('turns undefined into an explicit ok, because the wire needs a string', () => {
    expect(packToolResult(undefined)).toBe('{"ok":true}');
    expect(packToolResult(null)).toBe('{"ok":true}');
  });

  it('truncates an oversized result and says so', () => {
    const huge = { rows: Array.from({ length: 5000 }, (_, i) => `material line ${i}`) };
    const out = packToolResult(huge);
    const parsed = parse(out);
    expect(parsed.truncated).toBe(true);
    expect(parsed.preview).toHaveLength(MAX_TOOL_RESULT_CHARS);
    expect(parsed.note).toMatch(/narrower slice/);
  });

  it('does not truncate a result sitting just under the cap', () => {
    const s = 'x'.repeat(MAX_TOOL_RESULT_CHARS - 10);
    expect(packToolResult(s)).toBe(s);
  });
});
