/**
 * Birdhouse convo, 25 Aug 2026: three propose_update_customer cards sat on
 * screen at once — Kyle Van Lishout, Karl, Karl Van Lishout — every one still
 * tappable. Applying an old one resurrects a name the tradie already
 * corrected. A fresh proposal of the same decision must dismiss the stale
 * pending card.
 */
import { describe, it, expect } from 'vitest';
import { findSupersededProposals } from '../proposalSupersede';
import type { ChatMessage, Proposal } from '../../../types/assistant';

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

function updateCustomer(id: string, quoteId: string, name: string): Proposal {
  return {
    id,
    toolUseId: `t_${id}`,
    createdAt: new Date(2026, 7, 25).toISOString(),
    type: 'propose_update_customer',
    quoteId,
    customerDraft: { name },
    customerName: name,
  } as Proposal;
}

function draftQuote(id: string, jobName: string): Proposal {
  return {
    id,
    toolUseId: `t_${id}`,
    createdAt: new Date(2026, 7, 25).toISOString(),
    type: 'propose_draft_quote',
    jobName,
    jobDescription: 'Two plywood birdhouses for the backyard tree.',
    customerDraft: { name: 'Kyle' },
  } as Proposal;
}

describe('findSupersededProposals', () => {
  it('a newer update_customer dismisses the older pending one for the same quote', () => {
    const old = msg([updateCustomer('p1', 'q1', 'Kyle Van Lishout')]);
    const incoming = updateCustomer('p2', 'q1', 'Karl');
    const fresh = msg([incoming]);
    const refs = findSupersededProposals([old, fresh], [incoming], fresh.id);
    expect(refs).toEqual([{ messageId: old.id, proposalId: 'p1' }]);
  });

  it('never dismisses the card being appended right now', () => {
    const fresh = msg([updateCustomer('p1', 'q1', 'Karl')]);
    const refs = findSupersededProposals([fresh], [updateCustomer('p1', 'q1', 'Karl')], fresh.id);
    expect(refs).toEqual([]);
  });

  it('leaves update_customer cards for a DIFFERENT quote alone', () => {
    const other = msg([updateCustomer('p1', 'q_other', 'Sam')]);
    const incoming = updateCustomer('p2', 'q1', 'Karl');
    const refs = findSupersededProposals([other], [incoming], 'mX');
    expect(refs).toEqual([]);
  });

  it('skips cards already applied or dismissed', () => {
    const applied = msg([updateCustomer('p1', 'q1', 'Kyle')], { p1: 'applied' });
    const dismissed = msg([updateCustomer('p2', 'q1', 'Kyle VL')], { p2: 'dismissed' });
    const incoming = updateCustomer('p3', 'q1', 'Karl');
    const refs = findSupersededProposals([applied, dismissed], [incoming], 'mX');
    expect(refs).toEqual([]);
  });

  it('a re-proposed draft dismisses the earlier pending draft in the conversation', () => {
    const old = msg([draftQuote('p1', 'Two birdhouses')]);
    const incoming = draftQuote('p2', 'Two birdhouses — Karl Van Lishout');
    const refs = findSupersededProposals([old], [incoming], 'mX');
    expect(refs).toEqual([{ messageId: old.id, proposalId: 'p1' }]);
  });

  it('add_line_item never supersedes — three pending adds are three additions', () => {
    const addLine = (id: string): Proposal =>
      ({
        id,
        toolUseId: `t_${id}`,
        createdAt: new Date(2026, 7, 25).toISOString(),
        type: 'propose_add_line_item',
        quoteId: 'q1',
        searchTerm: 'treated pine',
        qty: 1,
        unit: 'each',
      }) as Proposal;
    const old = msg([addLine('p1')]);
    const refs = findSupersededProposals([old], [addLine('p2')], 'mX');
    expect(refs).toEqual([]);
  });
});
