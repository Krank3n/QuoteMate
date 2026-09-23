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
// propose_send_quote joined on 21 Sep 2026: the app mints a Send card the
// moment a quote is priced and someone can be sent to, and a re-price or a
// customer change mints a fresh one — the older card carries a stale total.
const PER_QUOTE = new Set([
  'propose_update_customer',
  'propose_update_quote_rates',
  'propose_update_quote_scope',
  'propose_send_quote',
]);

// Types where a newer card replaces an older pending one only when both say
// the SAME thing — the same rate (unit, figure, all-in or labour), the same
// rule. Matt Browns Concreting, 21 Sep 2026: the prep and pour rate cards
// were re-proposed three times under reworded labels ("Driveway concrete
// prep" / "Concrete driveway prep - plain finish") and eight pending cards
// stacked up. A different rate — the bobcat at its own hourly figure beside
// them — is a different decision and stays.
const SAME_CONTENT: Record<string, (p: Proposal) => string> = {
  propose_save_rate: (p) => {
    const r = p as Extract<Proposal, { type: 'propose_save_rate' }>;
    return `${r.unit}|${r.rate}|${r.includesMaterials}`;
  },
  propose_remember_preference: (p) =>
    (p as Extract<Proposal, { type: 'propose_remember_preference' }>).text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
};

function isPending(message: ChatMessage, proposal: Proposal): boolean {
  return (message.proposalStatus?.[proposal.id] ?? 'pending') === 'pending';
}

/**
 * Older pending proposals that `incoming` makes stale. The cards being
 * appended right now are never dismissed — but they are excluded by THEIR
 * ids, not by the bubble they land in: a reply that continues the previous
 * bubble (a turn boundary with no tradie speech between) can re-propose
 * into the very message that holds the stale card, and that card must still
 * go. `excludeMessageId` is kept for callers that pass it; it no longer
 * shields a whole message.
 */
export function findSupersededProposals(
  messages: ChatMessage[],
  incoming: Proposal[],
  _excludeMessageId?: string,
): SupersededRef[] {
  const refs: SupersededRef[] = [];
  const incomingIds = new Set(incoming.map((p) => p.id));
  for (const next of incoming) {
    const perConvo = PER_CONVERSATION.has(next.type);
    const perQuote = PER_QUOTE.has(next.type);
    const contentKey = SAME_CONTENT[next.type];
    if (!perConvo && !perQuote && !contentKey) continue;
    const nextQuoteId = (next as { quoteId?: string }).quoteId;
    for (const message of messages) {
      for (const prior of message.proposals || []) {
        if (prior.type !== next.type || incomingIds.has(prior.id)) continue;
        if (!isPending(message, prior)) continue;
        if (perQuote && (prior as { quoteId?: string }).quoteId !== nextQuoteId) continue;
        if (contentKey && contentKey(prior) !== contentKey(next)) continue;
        refs.push({ messageId: message.id, proposalId: prior.id });
      }
    }
  }
  return refs;
}
