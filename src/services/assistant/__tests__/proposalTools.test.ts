import { afterEach } from 'vitest';
import { buildProposal, setUnconsumedAttachmentProbe } from '../proposalTools';
import { rememberAppliedQuote } from '../quoteRefMap';
import type { ImportSupplierListProposal } from '../../../types/assistant';
import type {
  RepriceQuoteProposal,
  DeleteLineItemProposal,
  DeleteQuoteProposal,
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

describe('buildProposal propose_delete_quote', () => {
  it('requires a quoteId', () => {
    const { proposal, error } = buildProposal('propose_delete_quote', 'tool_dq_0', {});
    expect(proposal).toBeUndefined();
    expect(error).toMatch(/quoteId/);
  });

  it('resolves a proposal id to the minted quote id', () => {
    rememberAppliedQuote('prop_dq-1', 'doc_minted_dq');
    const { proposal, error } = buildProposal('propose_delete_quote', 'tool_dq_1', {
      quoteId: 'prop_dq-1',
      displayName: 'Raised deck with stairs',
      displayCustomerName: 'Gigar',
      displayTotal: 14360.77,
      displayDocType: 'quote',
    });
    expect(error).toBeUndefined();
    const dq = proposal as DeleteQuoteProposal;
    expect(dq.quoteId).toBe('doc_minted_dq');
    expect(dq.displayName).toBe('Raised deck with stairs');
    expect(dq.displayCustomerName).toBe('Gigar');
    expect(dq.displayTotal).toBeCloseTo(14360.77);
    expect(dq.displayDocType).toBe('quote');
  });

  it('coerces an unknown displayDocType to undefined', () => {
    const { proposal } = buildProposal('propose_delete_quote', 'tool_dq_2', {
      quoteId: 'doc_real',
      displayDocType: 'gibberish',
    });
    const dq = proposal as DeleteQuoteProposal;
    expect(dq.displayDocType).toBeUndefined();
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

  // The prompt and the tool schema both promise the card shows recipient AND
  // total; the card can only do that if buildProposal carries the figure.
  it('carries the total through for the card', () => {
    const { proposal } = buildProposal('propose_send_quote', 'tool_send_3', {
      quoteId: 'doc_send_3',
      recipientEmail: 'katie@example.com',
      displayTotal: 1183.5,
    });
    expect((proposal as SendQuoteProposal).displayTotal).toBe(1183.5);
  });

  it('leaves the total undefined rather than inventing one', () => {
    const { proposal } = buildProposal('propose_send_quote', 'tool_send_4', {
      quoteId: 'doc_send_4',
    });
    expect((proposal as SendQuoteProposal).displayTotal).toBeUndefined();
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

describe('propose_draft_quote description hygiene', () => {
  it('strips Mate conversation from the customer-facing description (QU-178342 leak)', () => {
    const { proposal, error } = buildProposal('propose_draft_quote', 'tool_leak', {
      jobName: 'Exposed aggregate driveway',
      customerDraft: { name: 'Tarik' },
      jobDescription:
        "Prep and poor 230 square metres of exposed aggregate what's their name and phone number so I can add them to your list customer name is tarik",
    });
    expect(error).toBeUndefined();
    expect((proposal as any).jobDescription).toBe('Prep and poor 230 square metres of exposed aggregate');
  });

  it('passes clean descriptions through untouched', () => {
    const clean = 'Construction of a 2m x 4m merbau deck with footings and two coats of oil.';
    const { proposal } = buildProposal('propose_draft_quote', 'tool_clean', {
      jobName: 'Deck build',
      customerDraft: { name: 'Sam' },
      jobDescription: clean,
    });
    expect((proposal as any).jobDescription).toBe(clean);
  });
});

// This card exists to unblock a tradie whose prices are wrong. Refusing it
// over a bad enum would be the worst possible moment to be pedantic, so the
// validator never errors — it coerces.
describe('buildProposal propose_import_supplier_list', () => {
  afterEach(() => setUnconsumedAttachmentProbe(() => false));

  it('builds with no arguments at all, defaulting source to "ask"', () => {
    const { proposal, error } = buildProposal('propose_import_supplier_list', 'tool_i0', {});
    expect(error).toBeUndefined();
    const p = proposal as ImportSupplierListProposal;
    expect(p.type).toBe('propose_import_supplier_list');
    expect(p.source).toBe('ask');
    expect(p.supplierName).toBeUndefined();
    expect(p.missedItems).toBeUndefined();
  });

  it('coerces an unknown source to "ask"', () => {
    const { proposal } = buildProposal('propose_import_supplier_list', 'tool_i1', {
      source: 'telepathy',
      reason: 'because',
    });
    const p = proposal as ImportSupplierListProposal;
    expect(p.source).toBe('ask');
    expect(p.reason).toBeUndefined();
  });

  it('downgrades "attachment" to "ask" when nothing is attached', () => {
    const { proposal } = buildProposal('propose_import_supplier_list', 'tool_i2', {
      source: 'attachment',
    });
    expect((proposal as ImportSupplierListProposal).source).toBe('ask');
  });

  it('keeps "attachment" when the chat still holds an unspent photo', () => {
    setUnconsumedAttachmentProbe(() => true);
    const { proposal } = buildProposal('propose_import_supplier_list', 'tool_i3', {
      source: 'attachment',
    });
    expect((proposal as ImportSupplierListProposal).source).toBe('attachment');
  });

  it('clamps missedItems to 5', () => {
    const { proposal } = buildProposal('propose_import_supplier_list', 'tool_i4', {
      missedItems: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    });
    expect((proposal as ImportSupplierListProposal).missedItems).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('trims supplierName and drops it when blank', () => {
    const named = buildProposal('propose_import_supplier_list', 'tool_i5', {
      supplierName: '  Metro Fencing  ',
    });
    expect((named.proposal as ImportSupplierListProposal).supplierName).toBe('Metro Fencing');

    const blank = buildProposal('propose_import_supplier_list', 'tool_i6', { supplierName: '   ' });
    expect((blank.proposal as ImportSupplierListProposal).supplierName).toBeUndefined();
  });
});
