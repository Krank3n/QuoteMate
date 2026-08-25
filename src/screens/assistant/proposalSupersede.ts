// Which older cards a fresh proposal makes stale.
//
// The birdhouse convo (25 Aug 2026) ended with three customer-update cards on
// screen at once — Kyle Van Lishout, Karl, Karl Van Lishout — every one still
// tappable. Applying an old one would resurrect a name the tradie already
// corrected. When Mate re-proposes, the superseded pending card gets dismissed
// so only the newest version of that decision can be applied.
//
// Deliberately narrow: only proposal types where two pending cards represent
// the SAME decision twice. propose_add_line_item stays out — three pending
// add-line cards are three different additions, all legitimate.

import type { ChatMessage, Proposal } from '../../types/assistant';

export interface SupersededRef {
  messageId: string;
  proposalId: string;
}

// Types where a newer card replaces an older pending one. propose_draft_quote
// supersedes per-conversation (no quote id exists yet); the others supersede
// per-quote.
const PER_CONVERSATION = new Set(['propose_draft_quote']);
const PER_QUOTE = new Set(['propose_update_customer', 'propose_update_quote_rates']);

function isPending(message: ChatMessage, proposal: Proposal): boolean {
  return (message.proposalStatus?.[proposal.id] ?? 'pending') === 'pending';
}

/**
 * Older pending proposals that `incoming` makes stale. `excludeMessageId` is
 * the message carrying the new proposals — never dismiss the cards being
 * appended right now (a turn can re-issue into the same bubble).
 */
export function findSupersededProposals(
  messages: ChatMessage[],
  incoming: Proposal[],
  excludeMessageId: string,
): SupersededRef[] {
  const refs: SupersededRef[] = [];
  for (const next of incoming) {
    const perConvo = PER_CONVERSATION.has(next.type);
    const perQuote = PER_QUOTE.has(next.type);
    if (!perConvo && !perQuote) continue;
    const nextQuoteId = (next as { quoteId?: string }).quoteId;
    for (const message of messages) {
      if (message.id === excludeMessageId) continue;
      for (const prior of message.proposals || []) {
        if (prior.type !== next.type || prior.id === next.id) continue;
        if (!isPending(message, prior)) continue;
        if (perQuote && (prior as { quoteId?: string }).quoteId !== nextQuoteId) continue;
        refs.push({ messageId: message.id, proposalId: prior.id });
      }
    }
  }
  return refs;
}
