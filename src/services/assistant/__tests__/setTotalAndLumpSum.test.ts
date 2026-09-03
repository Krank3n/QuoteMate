/**
 * Validators for the cards that let a tradie state the price: set the total,
 * add a lump sum, change one, pick a contact off the phone — and the guards
 * that came out of the same conversation (a padded phone number, customer
 * details written into a scope, a "$X" left in a customer email).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProposal, setProposalDocumentProbe } from '../proposalTools';
import { dispatchToolCall } from '../toolDispatcher';
import { setRenderableQuoteProbe } from '../showQuoteGate';
import { markPricingStarted, __resetPricingInFlight } from '../pricingInFlight';
import type {
  AddLineItemProposal,
  CreateContactProposal,
  DraftQuoteProposal,
  PickContactProposal,
  SetTotalProposal,
  UpdateCustomerProposal,
  UpdateLineItemProposal,
} from '../../../types/assistant';
import type { Material } from '../../../types';

/** INV-004 as the validator sees it: $549 of gear, $702 hourly labour, 30% markup, no GST. */
const INV_004 = {
  materials: [
    { id: 'm1', name: 'Switchboard enclosure', quantity: 1, unit: 'each', price: 549, totalPrice: 549, manualPriceOverride: false },
    { id: 'w1', name: 'Callout', kind: 'work', quantity: 1, unit: 'each', price: 180, totalPrice: 180, manualPriceOverride: true, pricingSource: 'manual' },
  ] as Material[],
  sections: [
    { id: 'a', name: 'Board', multiplier: 1, laborHours: 7.8, laborHoursTotal: 7.8, laborRate: 90, laborUnit: 'hours' as const, laborTotal: 702, sortOrder: 0 },
  ],
  laborRate: 90,
  laborHours: 7.8,
  markup: 30,
  laborMarkup: 0,
  pricesIncludeGst: false,
  gstRegistered: false,
};

beforeEach(() => {
  // The screen registers both: which ids render, and what the document holds.
  setRenderableQuoteProbe((id) => (id === 'inv-004' ? id : null));
  setProposalDocumentProbe((id) => (id === 'inv-004' ? INV_004 : null));
});
afterEach(() => {
  setRenderableQuoteProbe(null);
  setProposalDocumentProbe(null);
  __resetPricingInFlight();
});

describe('propose_set_total', () => {
  it('plans against the live document and carries the preview for the card', () => {
    const { proposal, error } = buildProposal('propose_set_total', 't', { quoteId: 'inv-004', targetTotal: 1232, displayName: 'Switchboard install' });
    expect(error).toBeUndefined();
    const p = proposal as SetTotalProposal;
    expect(p).toMatchObject({ type: 'propose_set_total', quoteId: 'inv-004', targetTotal: 1232, displayName: 'Switchboard install' });
    // 549 + 180 + 702 + 164.7 = 1595.7 → labour takes the 363.70 cut.
    expect(p.preview).toEqual({ currentTotal: 1595.7, mechanism: 'labour', labourBefore: 702, labourAfter: 338.3 });
  });

  it('refuses a total under the materials with the plain sentence, before any card goes up', () => {
    const { proposal, error } = buildProposal('propose_set_total', 't', { quoteId: 'inv-004', targetTotal: 400 });
    expect(proposal).toBeUndefined();
    expect(error).toContain("That's under the materials — they come to $549.00 on their own, so $549.00 is as low as this one goes.");
    expect(error).toContain("don't put a card up");
  });

  it('tells the model when the total is already there', () => {
    const { error } = buildProposal('propose_set_total', 't', { quoteId: 'inv-004', targetTotal: 1595.7 });
    expect(error).toContain('already $1,595.70');
  });

  it('refuses while the quote is still being priced — its total is not real yet', () => {
    markPricingStarted('inv-004');
    const { error } = buildProposal('propose_set_total', 't', { quoteId: 'inv-004', targetTotal: 1232 });
    expect(error).toContain('still being priced');
  });

  it('needs a real target and a real quote', () => {
    expect(buildProposal('propose_set_total', 't', { quoteId: 'inv-004', targetTotal: 0 }).error).toContain('targetTotal');
    expect(buildProposal('propose_set_total', 't', { quoteId: 'inv-004', targetTotal: 'twelve hundred' }).error).toContain('targetTotal');
    expect(buildProposal('propose_set_total', 't', { targetTotal: 1232 }).error).toContain('quoteId');
    expect(buildProposal('propose_set_total', 't', { quoteId: 'nope', targetTotal: 1232 }).error).toContain('never invent a quoteId');
  });

  it('still builds the card, without a preview, when the screen has not registered the document', () => {
    setProposalDocumentProbe(null);
    const { proposal, error } = buildProposal('propose_set_total', 't', { quoteId: 'inv-004', targetTotal: 1232.004 });
    expect(error).toBeUndefined();
    expect((proposal as SetTotalProposal).targetTotal).toBe(1232);
    expect((proposal as SetTotalProposal).preview).toBeUndefined();
  });
});

describe('propose_add_line_item — lump-sum form', () => {
  it('mints a work line at exactly the price the tradie said', () => {
    const { proposal, error } = buildProposal('propose_add_line_item', 't', {
      quoteId: 'inv-004',
      label: ' Skip bin and disposal ',
      price: 450.004,
      scope: 'Skip bin hire and tip fees for the old board and rubbish.',
      pricesIncludeGst: true,
    });
    expect(error).toBeUndefined();
    expect(proposal as AddLineItemProposal).toMatchObject({
      type: 'propose_add_line_item',
      quoteId: 'inv-004',
      searchTerm: 'Skip bin and disposal',
      kind: 'work',
      price: 450,
      qty: 1,
      unit: 'each',
      scope: 'Skip bin hire and tip fees for the old board and rubbish.',
      pricesIncludeGst: true,
    });
  });

  it('falls back to searchTerm as the label, and leaves the GST basis off when unsaid', () => {
    const { proposal } = buildProposal('propose_add_line_item', 't', { quoteId: 'inv-004', searchTerm: 'Callout', price: 180 });
    const p = proposal as AddLineItemProposal;
    expect(p.searchTerm).toBe('Callout');
    expect(p.kind).toBe('work');
    expect(p.pricesIncludeGst).toBeUndefined();
    expect(p.scope).toBeUndefined();
  });

  it('a $0 line is a legitimate lump sum ("included"); a negative one is not', () => {
    expect(buildProposal('propose_add_line_item', 't', { quoteId: 'inv-004', label: 'Site clean — included', price: 0 }).error).toBeUndefined();
    expect(buildProposal('propose_add_line_item', 't', { quoteId: 'inv-004', label: 'Discount', price: -50 }).error).toContain('propose_set_total');
  });

  it('names what a lump sum is missing, and keeps the material form as it was', () => {
    expect(buildProposal('propose_add_line_item', 't', { quoteId: 'inv-004', price: 180 }).error).toContain('label');
    expect(buildProposal('propose_add_line_item', 't', { quoteId: 'inv-004', label: 'x', price: 'heaps' }).error).toContain('number');
    expect(buildProposal('propose_add_line_item', 't', { quoteId: 'inv-004' }).error).toContain('label + price');
    const material = buildProposal('propose_add_line_item', 't', { quoteId: 'inv-004', searchTerm: '90x45 treated pine', qty: 4, unit: 'each' }).proposal as AddLineItemProposal;
    expect(material.kind).toBeUndefined();
    expect(material.price).toBeUndefined();
    expect(material).toMatchObject({ searchTerm: '90x45 treated pine', qty: 4, unit: 'each' });
  });
});

describe('propose_update_line_item on a lump sum', () => {
  it('stamps the row as a lump sum and fills the card from the document', () => {
    const { proposal, error } = buildProposal('propose_update_line_item', 't', { quoteId: 'inv-004', materialId: 'w1', price: 220 });
    expect(error).toBeUndefined();
    expect(proposal as UpdateLineItemProposal).toMatchObject({ lumpSum: true, price: 220, displayName: 'Callout', displayCurrentPrice: 180 });
    expect((proposal as UpdateLineItemProposal).displayUnit).toBeUndefined();
  });

  it('refuses a quantity change on a lump sum, and drops a quantity that rides along with a price', () => {
    expect(buildProposal('propose_update_line_item', 't', { quoteId: 'inv-004', materialId: 'w1', quantity: 2 }).error).toContain('lump sum');
    const { proposal } = buildProposal('propose_update_line_item', 't', { quoteId: 'inv-004', materialId: 'w1', price: 220, quantity: 2 });
    expect((proposal as UpdateLineItemProposal).quantity).toBeUndefined();
  });

  it('leaves a real material alone', () => {
    const { proposal } = buildProposal('propose_update_line_item', 't', { quoteId: 'inv-004', materialId: 'm1', quantity: 2, displayUnit: 'each' });
    expect(proposal as UpdateLineItemProposal).toMatchObject({ quantity: 2, displayUnit: 'each' });
    expect((proposal as UpdateLineItemProposal).lumpSum).toBeUndefined();
  });
});

describe('propose_pick_contact', () => {
  it('builds with no arguments (for the draft in hand) or with a known quote', () => {
    const bare = buildProposal('propose_pick_contact', 't', {});
    expect(bare.error).toBeUndefined();
    expect((bare.proposal as PickContactProposal).quoteId).toBeUndefined();
    const onQuote = buildProposal('propose_pick_contact', 't', { quoteId: 'inv-004', displayName: 'Switchboard install' });
    expect(onQuote.proposal as PickContactProposal).toMatchObject({ quoteId: 'inv-004', displayName: 'Switchboard install' });
  });

  it('refuses an invented quote id', () => {
    expect(buildProposal('propose_pick_contact', 't', { quoteId: 'quote_pending_1' }).error).toContain('never invent a quoteId');
  });
});

describe('phone numbers the model glued together', () => {
  it('drops a padded phone from a customer draft and tells the model to say so once', async () => {
    const { proposal, note } = buildProposal('propose_draft_quote', 't', {
      jobName: 'Switchboard install',
      jobDescription: 'Supply and install a new switchboard with circuit breakers.',
      customerDraft: { name: 'Sue and Peter Williamson', phone: '04 2875 A47528759', address: '70 Mount Larcom Bracewell Road' },
    });
    const draft = proposal as DraftQuoteProposal;
    expect(draft.customerDraft).toEqual({ name: 'Sue and Peter Williamson', address: '70 Mount Larcom Bracewell Road' });
    expect(note).toContain('left off');
    expect(note).toContain('do NOT ask for the rest again');
    // The dispatcher carries the note back with the ok.
    const out = await dispatchToolCall({
      name: 'propose_draft_quote',
      id: 'x',
      args: { jobName: 'Switchboard install', jobDescription: 'Supply and install a new switchboard with circuit breakers.', customerDraft: { name: 'Sue', phone: '04' } },
    });
    expect(out.response.ok).toBe(true);
    expect(out.response.note).toContain('left off');
  });

  it('keeps and formats a whole number on every contact-carrying card', () => {
    const draft = buildProposal('propose_draft_quote', 't', {
      jobName: 'Deck',
      jobDescription: 'Build a 20 m² merbau deck off the back of the house.',
      customerDraft: { name: 'Diane', phone: '0477535423' },
    }).proposal as DraftQuoteProposal;
    expect(draft.customerDraft?.phone).toBe('0477 535 423');
    const contact = buildProposal('propose_create_contact', 't', { name: 'Bob', phone: '+61 412 345 678' }).proposal as CreateContactProposal;
    expect(contact.phone).toBe('0412 345 678');
    const update = buildProposal('propose_update_customer', 't', { quoteId: 'inv-004', customerDraft: { name: 'Sue', phone: '04268753564' } });
    expect((update.proposal as UpdateCustomerProposal).customerDraft?.phone).toBeUndefined();
    expect(update.note).toContain('left off');
  });
});

describe('customer details are not scope', () => {
  it('sends a scope update carrying contact details to propose_update_customer', () => {
    const { error } = buildProposal('propose_update_quote_scope', 't', {
      quoteId: 'inv-004',
      jobDescription: 'New customer details.\nFull Name: Sue and Peter Williamson\nPhone number: 0428753564\nAddress: 770 Mount Larcom Bracewell Road',
    });
    expect(error).toContain('propose_update_customer');
  });

  it('keeps the same details out of a fresh draft', () => {
    const { error } = buildProposal('propose_draft_quote', 't', {
      jobName: 'Switchboard',
      jobDescription: 'Full name: Sue Williamson. Phone number: 0428753564. Replace the switchboard.',
      customerDraft: { name: 'Sue' },
    });
    expect(error).toContain('never in the scope');
  });
});

describe('placeholders in a customer email', () => {
  it('refuses a body with $X / [Business Name] in it and says what to do instead', () => {
    const { error } = buildProposal('propose_send_quote', 't', {
      quoteId: 'inv-004',
      draftEmailBody: 'Hello Peter and Sue,\n\nTotal materials: $X\nTotal labour: $Y\nTotal: $1,415.70\n\nCheers,\n[Business Name]',
    });
    expect(error).toContain('"$X"');
    expect(error).toContain('get_quote');
  });

  it('lets a real body through', () => {
    const { error } = buildProposal('propose_send_quote', 't', {
      quoteId: 'inv-004',
      draftEmailBody: 'Hello Peter and Sue,\n\nPlease find attached invoice INV-004 for $1,415.70.\n\nCheers,\nLeo Wright Electrical Services',
    });
    expect(error).toBeUndefined();
  });
});
