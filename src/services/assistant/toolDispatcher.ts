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
  getQuote,
  listRecentQuotes,
  reviewQuote,
} from './readTools';
import { buildProposal } from './proposalTools';
import { isProposalTool, isReadTool } from './toolSchemas';

export interface ToolCallInput {
  name: string;
  id: string;
  args: any;
}

export interface ToolCallOutput {
  name: string;
  id: string;
  // Sent back to Gemini as the toolResponse.functionResponses[].response.
  response: any;
  // When a propose_* call validated cleanly, the typed Proposal that should
  // be rendered as a card under the assistant message.
  proposal?: Proposal;
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
      }
      return { name, id, response: result as any };
    } catch (err: any) {
      return { name, id, response: { error: err?.message || 'Tool execution failed.' } };
    }
  }

  if (isProposalTool(name)) {
    const { proposal, error } = buildProposal(name, id, input);
    if (proposal) {
      return { name, id, response: { ok: true, proposalId: proposal.id }, proposal };
    }
    return { name, id, response: { error: error || 'Proposal validation failed.' } };
  }

  return { name, id, response: { error: `Unknown tool: ${name}` } };
}
