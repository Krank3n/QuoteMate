// Dispatch a single Live-API tool call to the matching local handler.
//
// Read tools hit Firestore (client SDK, scoped by auth.currentUser.uid) and
// return the raw payload as the model's tool_result. Proposal tools never
// touch state — they validate the payload and return a typed Proposal that
// the chat surface attaches to the assistant message; the model only sees
// `{ ok: true, proposalId }` so it knows the card was queued for the tradie.

import { Proposal } from '../../types/assistant';
import {
  findCustomer,
  getBusinessDefaults,
  getJobRequirements,
  getQuote,
  listRecentQuotes,
  reviewQuote,
} from './readTools';
import { buildProposal } from './proposalTools';
import { resolveQuoteId } from './quoteRefMap';
import { isProposalTool, isReadTool } from './toolSchemas';

export interface ToolCallInput {
  name: string;
  id: string;
  args: any;
}

// A UI-only action the model asked for that the chat screen carries out (e.g.
// show a quote on screen). Unlike read tools it returns no data, and unlike
// proposals it isn't a confirmable card — the screen acts on it directly.
export interface ViewAction {
  kind: 'show_quote';
  quoteId: string;
}

export interface ToolCallOutput {
  name: string;
  id: string;
  // Sent back to Gemini as the toolResponse.functionResponses[].response.
  response: any;
  // When a propose_* call validated cleanly, the typed Proposal that should
  // be rendered as a card under the assistant message.
  proposal?: Proposal;
  // When a view tool (show_quote) was called, the action the screen should
  // carry out. The screen validates the id and overrides `response`.
  view?: ViewAction;
}

export async function dispatchToolCall(call: ToolCallInput): Promise<ToolCallOutput> {
  const { name, id, args } = call;
  const input = args || {};

  if (isReadTool(name)) {
    try {
      let result: unknown;
      switch (name) {
        case 'find_customer':
          result = await findCustomer(input);
          break;
        case 'list_recent_quotes':
          result = await listRecentQuotes(input);
          break;
        case 'get_quote':
          result = await getQuote(input);
          break;
        case 'get_business_defaults':
          result = await getBusinessDefaults();
          break;
        case 'review_quote':
          result = await reviewQuote(input);
          break;
        case 'get_job_requirements':
          result = await getJobRequirements(input as { category?: string; niche?: string; freeText?: string });
          break;
      }
      return { name, id, response: result as any };
    } catch (err: any) {
      return { name, id, response: { error: err?.message || 'Tool execution failed.' } };
    }
  }

  if (name === 'show_quote') {
    if (!input?.quoteId) {
      return { name, id, response: { error: 'show_quote requires quoteId.' } };
    }
    // Resolve a proposalId → minted doc id if the model reused one; the screen
    // confirms the id actually exists and overrides the response.
    const quoteId = resolveQuoteId(String(input.quoteId));
    return { name, id, response: { ok: true }, view: { kind: 'show_quote', quoteId } };
  }

  if (isProposalTool(name)) {
    const { proposal, error } = buildProposal(name, id, input);
    if (proposal) {
      const response: Record<string, unknown> = { ok: true, proposalId: proposal.id };
      if (proposal.type === 'propose_draft_quote') {
        // The proposalId is NOT a quote id — no quote exists until the tradie
        // taps Apply. Spell that out so the model doesn't later pass proposalId
        // to get_quote / review_quote / propose_reprice.
        response.note =
          'Card shown — nothing is saved until the tradie taps Apply. proposalId is not a quote id; the real quote id arrives in a "[context]" line after Apply.';
      }
      return { name, id, response, proposal };
    }
    return { name, id, response: { error: error || 'Proposal validation failed.' } };
  }

  return { name, id, response: { error: `Unknown tool: ${name}` } };
}
