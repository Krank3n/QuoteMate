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
