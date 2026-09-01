// Mate's tools, bridged to the ElevenLabs client-tool contract.
//
// The wire carries `client_tool_result.result` as a STRING, so every handler
// returns one. dispatchToolCall stays provider-neutral — this file only
// translates the calling convention, exactly as the Gemini toolCall/toolResponse
// branch in the old voiceSession did.
//
// Handlers are built by iterating the declarations rather than hand-listing
// names, so "every tool the agent knows about has a handler" is structurally
// true rather than a thing someone has to remember.

import { Proposal } from '../../types/assistant';
import { generateId } from '../../utils/generateId';
import { dispatchToolCall } from './toolDispatcher';
import { ALL_TOOL_DECLARATIONS, isControlTool } from './toolSchemas';

/**
 * The screen-owned half of tool handling. Read and proposal tools resolve
 * entirely inside dispatchToolCall; these three need the live chat surface.
 */
export interface ToolCallbacks {
  /** A propose_* call validated and ready to render as a card. */
  onProposal?: (proposal: Proposal) => void;
  /**
   * The tradie accepted or backed out of the waiting card by voice. Returns
   * whether a card was actually up, so Mate is told the truth rather than
   * claiming it sent something when nothing was waiting.
   */
  onControlAction?: (
    decision: 'apply' | 'cancel',
    proposalId?: string,
  ) => { ok: boolean; error?: string };
  /** Mate asked to put a quote on screen. Returns whether the id resolved. */
  onShowQuote?: (quoteId: string) => { ok: boolean; error?: string };
}

/**
 * Ceiling on a single tool result.
 *
 * Unlike the Gemini path, this string lands in the agent's LLM context and
 * stays there for the rest of the conversation. get_quote on a 60-line
 * materials list or list_recent_quotes at limit 25 is tens of KB, which would
 * be re-billed on every subsequent turn and crowd out the actual conversation.
 */
export const MAX_TOOL_RESULT_CHARS = 12_000;

/**
 * Serialise a tool result for the wire.
 *
 * `undefined` is not a string, and a handler that resolves to nothing would
 * otherwise stall the turn until response_timeout_secs — so an absent value
 * becomes an explicit ok.
 */
export function packToolResult(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? { ok: true });
  if (s.length <= MAX_TOOL_RESULT_CHARS) return s;
  return JSON.stringify({
    truncated: true,
    note: `Result was ${s.length} characters and has been cut to fit. Ask for a narrower slice — a specific quote id, a smaller limit — rather than re-running this call.`,
    preview: s.slice(0, MAX_TOOL_RESULT_CHARS),
  });
}

/**
 * Build the clientTools map handed to Conversation.startSession.
 *
 * Every handler RESOLVES, never rejects — including on failure. The SDK only
 * sets is_error when a handler rejects, and a rejection surfaces through
 * onError (risking a user-visible error bubble for a recoverable tool miss)
 * and leaves the turn hanging until the timeout. Mate's prompt and the text
 * path are both already trained on `{ error: "..." }` as a normal result, so
 * that is the shape failures take here too.
 */
export function buildClientTools(
  cb: ToolCallbacks,
): Record<string, (parameters: any) => Promise<string>> {
  const tools: Record<string, (parameters: any) => Promise<string>> = {};

  for (const decl of ALL_TOOL_DECLARATIONS) {
    const name = decl.name;
    tools[name] = async (parameters: any): Promise<string> => {
      try {
        // Control tools never reach the dispatcher on the voice path — the
        // screen resolves the pinned card and its verdict is the result.
        if (isControlTool(name)) {
          const decision = name === 'apply_pending_proposal' ? 'apply' : 'cancel';
          const proposalId = parameters?.proposalId ? String(parameters.proposalId) : undefined;
          const verdict = cb.onControlAction?.(decision, proposalId)
            ?? { ok: false, error: 'Voice control is unavailable right now.' };
          return packToolResult(verdict);
        }

        const result = await dispatchToolCall({ name, id: generateId(), args: parameters || {} });

        // show_quote renders inline; the screen's answer replaces the
        // dispatcher's optimistic ok so Mate never claims a quote is on screen
        // when it isn't.
        if (result.view?.kind === 'show_quote') {
          const verdict = cb.onShowQuote?.(result.view.quoteId) ?? { ok: true };
          return packToolResult(verdict);
        }

        if (result.proposal) cb.onProposal?.(result.proposal);

        return packToolResult(result.response);
      } catch (err: any) {
        return packToolResult({ error: err?.message || 'Tool execution failed.' });
      }
    };
  }

  return tools;
}
