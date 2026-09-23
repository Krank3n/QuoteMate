/**
 * The shared "which card does 'it' mean" lookup — extracted from the voice
 * session's onControlAction so the typed-confirm path resolves the identical
 * card a spoken confirm would.
 */
import { describe, it, expect } from 'vitest';
import { findPendingProposal, pendingCardsForYes, resolveControlTarget } from '../pendingProposal';
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

describe('pendingCardsForYes — Matt Browns Concreting, 21 Sep 2026: two rate cards, "Yeah" ×4, nothing saved', () => {
  const rate = (id: string, rate: number): Proposal =>
    ({ id, toolUseId: `t_${id}`, createdAt: '2026-09-21T10:02:34Z', type: 'propose_save_rate', label: `Rate ${id}`, unit: 'm²', rate, includesMaterials: false }) as Proposal;

  it('a yes confirms every waiting card of the same kind in that message', () => {
    const m = msg([rate('prep', 135), rate('pour', 140)]);
    expect(pendingCardsForYes(m, m.proposals![1]).map((p) => p.id)).toEqual(['prep', 'pour']);
  });

  it('skips a sibling already applied or dismissed', () => {
    const m = msg([rate('prep', 135), rate('pour', 140)], { prep: 'applied' });
    expect(pendingCardsForYes(m, m.proposals![1]).map((p) => p.id)).toEqual(['pour']);
  });

  it('a card of another kind beside it is not swept in', () => {
    const m = msg([rate('downlights', 60), prop('send-1')]);
    expect(pendingCardsForYes(m, m.proposals![1]).map((p) => p.id)).toEqual(['send-1']);
    expect(pendingCardsForYes(m, m.proposals![0]).map((p) => p.id)).toEqual(['downlights']);
  });
});

describe('resolveControlTarget — the history Mate is sent carries no card ids', () => {
  it('an id no card ever had is read as a plain yes to the newest waiting card', () => {
    const m = msg([prop('real-1')]);
    expect(resolveControlTarget([m], 'prop_made_up')).toMatchObject({ proposal: { id: 'real-1' }, group: true });
  });

  it('a real id that is still waiting pins that card alone', () => {
    const a = msg([prop('a1')]);
    const b = msg([prop('b1')]);
    expect(resolveControlTarget([a, b], 'a1')).toMatchObject({ proposal: { id: 'a1' }, group: false });
  });

  it('a real id that has been resolved is refused — never redirected onto another card', () => {
    const a = msg([prop('a1')], { a1: 'applied' });
    const b = msg([prop('b1')]);
    expect(resolveControlTarget([a, b], 'a1')).toBeNull();
  });

  it('no id and nothing waiting → null', () => {
    expect(resolveControlTarget([msg([prop('a1')], { a1: 'dismissed' })])).toBeNull();
  });
});
