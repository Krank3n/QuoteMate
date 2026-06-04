import { buildProposal } from '../proposalTools';
import { rememberAppliedQuote } from '../quoteRefMap';
import type {
  RepriceQuoteProposal,
  DeleteLineItemProposal,
  SendQuoteProposal,
  UpdateCustomerProposal,
} from '../../../types/assistant';

describe('buildProposal quoteId resolution', () => {
  it('resolves a proposal id to the minted quote id for propose_reprice', () => {
    rememberAppliedQuote('prop_reprice-1', 'doc_minted_1');
    const { proposal, error } = buildProposal('propose_reprice', 'tool_1', {
      quoteId: 'prop_reprice-1',
    });
    expect(error).toBeUndefined();
    expect((proposal as RepriceQuoteProposal).quoteId).toBe('doc_minted_1');
  });

  it('resolves a proposal id for propose_delete_line_item', () => {
    rememberAppliedQuote('prop_del-1', 'doc_minted_2');
    const { proposal } = buildProposal('propose_delete_line_item', 'tool_2', {
      quoteId: 'prop_del-1',
      materialId: 'mat_9',
    });
    expect((proposal as DeleteLineItemProposal).quoteId).toBe('doc_minted_2');
    expect((proposal as DeleteLineItemProposal).materialId).toBe('mat_9');
  });

  it('passes a real quote id through untouched', () => {
    const { proposal } = buildProposal('propose_reprice', 'tool_3', { quoteId: 'doc_real' });
    expect((proposal as RepriceQuoteProposal).quoteId).toBe('doc_real');
  });
});

describe('buildProposal propose_send_quote', () => {
  it('carries a Mate-drafted email body and subject onto the proposal', () => {
    const { proposal, error } = buildProposal('propose_send_quote', 'tool_send_1', {
      quoteId: 'doc_send',
      recipientEmail: 'katie@example.com',
      draftEmailBody: 'Hi Katie, your quote is attached. Sing out with any questions.',
      draftEmailSubject: 'Your quote',
    });
    expect(error).toBeUndefined();
    const send = proposal as SendQuoteProposal;
    expect(send.quoteId).toBe('doc_send');
    expect(send.recipientEmail).toBe('katie@example.com');
    expect(send.draftEmailBody).toBe('Hi Katie, your quote is attached. Sing out with any questions.');
    expect(send.draftEmailSubject).toBe('Your quote');
  });

  it('leaves the draft fields undefined when Mate did not write one', () => {
    const { proposal } = buildProposal('propose_send_quote', 'tool_send_2', {
      quoteId: 'doc_send_2',
    });
    const send = proposal as SendQuoteProposal;
    expect(send.draftEmailBody).toBeUndefined();
    expect(send.draftEmailSubject).toBeUndefined();
  });
});

describe('buildProposal propose_update_customer', () => {
  it('requires a quoteId', () => {
    const { proposal, error } = buildProposal('propose_update_customer', 'tool_uc_0', {
      customerId: 'contact_1',
    });
    expect(proposal).toBeUndefined();
    expect(error).toMatch(/quoteId/);
  });

  it('requires a customerId or customerDraft.name', () => {
    const { proposal, error } = buildProposal('propose_update_customer', 'tool_uc_1', {
      quoteId: 'doc_uc',
    });
    expect(proposal).toBeUndefined();
    expect(error).toMatch(/customerId|customerDraft/);
  });

  it('carries an existing contact id and resolves the quote id', () => {
    rememberAppliedQuote('prop_uc-1', 'doc_minted_uc');
    const { proposal, error } = buildProposal('propose_update_customer', 'tool_uc_2', {
      quoteId: 'prop_uc-1',
      customerId: 'contact_42',
      customerName: 'Jane Doe',
    });
    expect(error).toBeUndefined();
    const uc = proposal as UpdateCustomerProposal;
    expect(uc.quoteId).toBe('doc_minted_uc');
    expect(uc.customerId).toBe('contact_42');
    expect(uc.customerName).toBe('Jane Doe');
    expect(uc.customerDraft).toBeUndefined();
  });

  it('carries a new-contact draft and defaults customerName to the draft name', () => {
    const { proposal } = buildProposal('propose_update_customer', 'tool_uc_3', {
      quoteId: 'doc_uc_2',
      customerDraft: { name: 'Bob Builder', phone: '0400000000' },
    });
    const uc = proposal as UpdateCustomerProposal;
    expect(uc.customerId).toBeUndefined();
    expect(uc.customerDraft?.name).toBe('Bob Builder');
    expect(uc.customerName).toBe('Bob Builder');
  });
});
