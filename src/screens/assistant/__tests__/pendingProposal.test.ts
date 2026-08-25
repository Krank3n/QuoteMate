/**
 * The shared "which card does 'it' mean" lookup — extracted from the voice
 * session's onControlAction so the typed-confirm path resolves the identical
 * card a spoken confirm would.
 */
import { describe, it, expect } from 'vitest';
import { findPendingProposal } from '../pendingProposal';
import type { ChatMessage, Proposal } from '../../../types/assistant';

function prop(id: string): Proposal {
  return {
    id,
    toolUseId: `t_${id}`,
    createdAt: new Date(2026, 7, 25).toISOString(),
    type: 'propose_send_quote',
    quoteId: 'q1',
  } as Proposal;
}

let seq = 0;
function msg(proposals: Proposal[], proposalStatus?: ChatMessage['proposalStatus']): ChatMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    role: 'assistant',
    text: '',
    createdAt: new Date(2026, 7, 25, 20, 0, seq).toISOString(),
    proposals,
    proposalStatus,
  } as ChatMessage;
}

describe('findPendingProposal', () => {
  it('newest pending card wins', () => {
    const older = msg([prop('p1')]);
    const newer = msg([prop('p2')]);
    const found = findPendingProposal([older, newer]);
    expect(found?.proposal.id).toBe('p2');
    expect(found?.message.id).toBe(newer.id);
  });

  it('an explicit proposalId pins that specific card', () => {
    const older = msg([prop('p1')]);
    const newer = msg([prop('p2')]);
    expect(findPendingProposal([older, newer], 'p1')?.proposal.id).toBe('p1');
  });

  it('skips applied/dismissed cards — a resolved card is never "it"', () => {
    const applied = msg([prop('p1')], { p1: 'applied' });
    const dismissed = msg([prop('p2')], { p2: 'dismissed' });
    expect(findPendingProposal([applied, dismissed])).toBeNull();
  });

  it('missing status map means pending (matches the card renderer)', () => {
    const bare = msg([prop('p1')]);
    expect(findPendingProposal([bare])?.proposal.id).toBe('p1');
  });
});
