import type { ChatMessage, Proposal } from '../../types/assistant';

// The card a spoken or typed "yes"/"nah" resolves. Newest pending card wins;
// an explicit proposalId (if Mate tracked one) pins that specific card. Used
// by the voice session's onControlAction and the text path's dispatcher probe
// so both surfaces agree on which card "it" is.
export function findPendingProposal(
  messages: ChatMessage[],
  proposalId?: string,
): { message: ChatMessage; proposal: Proposal } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m.proposals?.length) continue;
    const status = m.proposalStatus || {};
    for (let j = m.proposals.length - 1; j >= 0; j--) {
      const p = m.proposals[j];
      if ((status[p.id] || 'pending') !== 'pending') continue;
      if (proposalId && p.id !== proposalId) continue;
      return { message: m, proposal: p };
    }
  }
  return null;
}

// The cards one "yes" confirms: the pinned card plus every other pending card
// of the SAME kind that Mate put up alongside it in that message ("two cards
// up — tap to confirm both"). Matt Browns Concreting, 21 Sep 2026: two rate
// cards up, "Yeah" typed four times, nothing saved — a yes resolved at most
// one card, so the model kept putting the pair up again instead. Mixed kinds
// (a draft beside a save-rate card) stay one card per yes; the model names
// the other by id if the tradie means it too.
export function pendingCardsForYes(message: ChatMessage, pinned: Proposal): Proposal[] {
  const status = message.proposalStatus || {};
  const same = (message.proposals || []).filter(
    (p) => p.type === pinned.type && (status[p.id] || 'pending') === 'pending',
  );
  return same.some((p) => p.id === pinned.id) ? same : [pinned];
}

// Which card a spoken or typed yes/nah resolves, from the id the model passed
// (if any). The chat history Mate is sent carries text only — a card's id
// exists in the turn that proposed it and nowhere after — so on the next turn
// a model that "knows" the id has made it up. Sim, 23 Sep 2026: "yeah go
// ahead" on a waiting Update scope card → apply_pending_proposal with an id
// that never existed → "That card is no longer waiting." → Mate put up two
// fresh copies of the card instead. An id no card in the chat ever had is
// read as a plain yes; a real id that has since been resolved is still
// refused, so a stale confirm can't land on a different card.
export function resolveControlTarget(
  messages: ChatMessage[],
  proposalId?: string,
): { message: ChatMessage; proposal: Proposal; group: boolean } | null {
  if (proposalId) {
    const pinned = findPendingProposal(messages, proposalId);
    if (pinned) return { ...pinned, group: false };
    const everShown = messages.some((m) => (m.proposals || []).some((p) => p.id === proposalId));
    if (everShown) return null;
  }
  const newest = findPendingProposal(messages);
  return newest ? { ...newest, group: true } : null;
}
