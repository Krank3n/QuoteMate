/**
 * 2 Sep 2026 draft audit: 34 drafts applied across 44 Mate conversations and
 * not one send offer, because nothing gave the model a turn after the card
 * landed (text) or let it say the total (voice). These pin the pure half of
 * the fix — when a turn is earned and what the note tells Mate to do.
 */
import { describe, it, expect } from 'vitest';
import {
  buildContactAskNote,
  buildSendCardProposal,
  buildSendOfferNote,
  describeDraftCustomer,
  formatAudRounded,
  isUnsentSource,
  SEND_CARD_TOOL_USE_PREFIX,
  sendCardLine,
  sendOfferFactsForQuote,
  sendOfferLine,
  shouldAskContactDuringPricing,
  shouldOfferSendTurn,
} from '../sendOfferNote';

describe('sendOfferFactsForQuote', () => {
  it('reads name, customer, total and whether anyone can be sent to', () => {
    const facts = sendOfferFactsForQuote({
      job: { name: 'Patio roof — Lee-Anne' },
      customerName: 'Lee-Anne',
      customerEmail: '',
      customerPhone: '0412 000 000',
      total: 12687.4,
      type: 'quote',
    });
    expect(facts).toEqual({
      jobName: 'Patio roof — Lee-Anne',
      customerName: 'Lee-Anne',
      total: 12687.4,
      hasContact: true,
      docType: 'quote',
    });
  });

  it('no email and no mobile means nobody to send to', () => {
    const facts = sendOfferFactsForQuote({ job: { name: 'Mulching' }, customerName: 'Strara', total: 2842 });
    expect(facts.hasContact).toBe(false);
  });

  it('falls back to the proposal job name and treats a converted invoice as one', () => {
    const facts = sendOfferFactsForQuote({ job: { name: '' }, type: 'invoice' }, 'Big gable reroof');
    expect(facts.jobName).toBe('Big gable reroof');
    expect(facts.docType).toBe('invoice');
    expect(facts.total).toBeUndefined();
  });
});

describe('shouldOfferSendTurn', () => {
  const base = { proposalType: 'propose_draft_quote', ok: true, pipelineDegraded: false, voiceOpen: false };

  it('a priced draft in text chat earns the turn', () => {
    expect(shouldOfferSendTurn(base)).toBe(true);
  });

  it('so does a priced scope update', () => {
    expect(shouldOfferSendTurn({ ...base, proposalType: 'propose_update_quote_scope' })).toBe(true);
  });

  it('never over an unpriced quote — there is nothing to send yet', () => {
    expect(shouldOfferSendTurn({ ...base, pipelineDegraded: true })).toBe(false);
    expect(shouldOfferSendTurn({ ...base, ok: false })).toBe(false);
  });

  it('never in voice — [pipeline-done] is that turn', () => {
    expect(shouldOfferSendTurn({ ...base, voiceOpen: true })).toBe(false);
  });

  it('not for rate tweaks, sends, or anything else', () => {
    for (const t of ['propose_update_quote_rates', 'propose_reprice', 'propose_send_quote', 'propose_add_line_item']) {
      expect(shouldOfferSendTurn({ ...base, proposalType: t })).toBe(false);
    }
  });
});

describe('formatAudRounded', () => {
  it('rounds and groups thousands without locale tables', () => {
    expect(formatAudRounded(12687.4)).toBe('$12,687');
    expect(formatAudRounded(950)).toBe('$950');
    expect(formatAudRounded(1234567.89)).toBe('$1,234,568');
  });
});

describe('buildSendOfferNote', () => {
  const withContact = {
    jobName: 'Patio roof — Lee-Anne',
    customerName: 'Lee-Anne',
    total: 12687,
    hasContact: true,
    docType: 'quote' as const,
  };

  it('tells Mate to offer the send, with the customer and the total, in one line', () => {
    const note = buildSendOfferNote(withContact);
    expect(note.startsWith('[context]')).toBe(true);
    expect(note).toContain('ONE short line');
    expect(note).toContain(sendOfferLine(withContact));
    expect(note).toContain("Lee-Anne's quote at $12,687");
    expect(note).toContain('want me to send it?');
    expect(note).toMatch(/never say the tag/i);
  });

  it('with nobody to send to, asks for an email or mobile instead of offering', () => {
    const note = buildSendOfferNote({ ...withContact, customerName: 'Strara', hasContact: false });
    expect(note).toContain('NO email or mobile on file');
    expect(note).toContain('email or mobile');
    expect(note).not.toContain('want me to send it?');
  });

  it('keeps the row summary off the table — the card shows it', () => {
    expect(buildSendOfferNote(withContact)).toMatch(/don't repeat the row summary/i);
  });

  it('names an invoice as an invoice', () => {
    expect(buildSendOfferNote({ ...withContact, docType: 'invoice' })).toContain("Lee-Anne's invoice");
  });
});


describe('buildSendOfferNote with corrections said while pricing ran', () => {
  it('puts the corrections before the send offer — never offer to send the wrong quote', () => {
    const note = buildSendOfferNote(
      { jobName: 'Install fire detectors', customerName: 'Diane Bunk', total: 797.04, hasContact: true, docType: 'quote' },
      ['using red dot brand', "those detectors are pre-existing, I'm just replacing existing hardwire"],
      'q-smoke-1',
    );
    expect(note).toContain('"using red dot brand"');
    expect(note).toContain('propose_update_quote_scope on q-smoke-1');
    expect(note).toContain('Do that BEFORE offering the send.');
    expect(note).not.toContain('want me to send it?');
  });

  it('is the plain send offer when nothing was said', () => {
    const note = buildSendOfferNote({ jobName: 'Deck', customerName: 'Katie', total: 1183, hasContact: true, docType: 'quote' });
    expect(note).toContain('want me to send it?');
    expect(note).not.toContain('While pricing ran');
  });
});

/**
 * 19 Sep 2026 audit: 58 Mate chats reached a priced card, 44 with no email or
 * mobile on file; with a contact on file "want me to send it?" got 0 yeses in
 * 13 asks. So the contact is asked for while pricing runs, and the offer is a
 * Send card the app mints itself.
 */
describe('describeDraftCustomer', () => {
  const contacts: Record<string, { name: string; phone?: string; email?: string }> = {
    c1: { name: 'Lee-Anne', phone: '0412 000 000' },
    c2: { name: 'Bob' },
  };
  const find = (id: string) => contacts[id];

  it('reads an existing contact by id first', () => {
    expect(describeDraftCustomer({ customerId: 'c1' }, find)).toEqual({ name: 'Lee-Anne', hasContact: true });
    expect(describeDraftCustomer({ customerId: 'c2', customerDraft: { name: 'Bob', phone: '04' } }, find))
      .toEqual({ name: 'Bob', hasContact: false });
  });

  it('an uncached contact is unknown, not missing', () => {
    expect(describeDraftCustomer({ customerId: 'nope', customerDraft: { name: 'Sam' } }, find))
      .toEqual({ name: 'Sam', hasContact: null });
  });

  it('reads a fresh customerDraft', () => {
    expect(describeDraftCustomer({ customerDraft: { name: ' Jobel ', email: 'j@example.com' } }, find))
      .toEqual({ name: 'Jobel', hasContact: true });
    expect(describeDraftCustomer({ customerDraft: { name: 'Jobel' } }, find)).toEqual({ name: 'Jobel', hasContact: false });
    expect(describeDraftCustomer({}, find)).toEqual({ hasContact: null });
  });
});

describe('shouldAskContactDuringPricing', () => {
  const missing = { name: 'Jobel', hasContact: false as const };

  it('asks on a fresh draft with a named customer and no way to reach them', () => {
    expect(shouldAskContactDuringPricing({ proposalType: 'propose_draft_quote', customer: missing, voiceOpen: false })).toBe(true);
  });

  it('never asks when a contact is on file, or is merely uncached', () => {
    expect(shouldAskContactDuringPricing({ proposalType: 'propose_draft_quote', customer: { name: 'Jobel', hasContact: true }, voiceOpen: false })).toBe(false);
    expect(shouldAskContactDuringPricing({ proposalType: 'propose_draft_quote', customer: { name: 'Jobel', hasContact: null }, voiceOpen: false })).toBe(false);
  });

  it('never asks for a ballpark placeholder, a scope update, or in voice', () => {
    expect(shouldAskContactDuringPricing({ proposalType: 'propose_draft_quote', customer: { name: 'Unnamed job', hasContact: false }, voiceOpen: false })).toBe(false);
    expect(shouldAskContactDuringPricing({ proposalType: 'propose_draft_quote', customer: { hasContact: false }, voiceOpen: false })).toBe(false);
    expect(shouldAskContactDuringPricing({ proposalType: 'propose_update_quote_scope', customer: missing, voiceOpen: false })).toBe(false);
    expect(shouldAskContactDuringPricing({ proposalType: 'propose_draft_quote', customer: missing, voiceOpen: true })).toBe(false);
  });
});

describe('buildContactAskNote', () => {
  it('asks for a mobile or email, names the quote, and holds any answer until pricing lands', () => {
    const note = buildContactAskNote({ quoteId: 'q-77', jobName: 'Retaining wall', customerName: 'Jobel' });
    expect(note.startsWith('[context]')).toBe(true);
    expect(note).toContain('NO email or mobile on file for Jobel');
    expect(note).toContain('got a mobile or email for Jobel?');
    expect(note).toContain('propose_update_customer on q-77');
    expect(note).toContain('only after the "[context]" line that says pricing finished');
    expect(note).toContain("don't ask again");
    expect(note).toContain('Never say the tag');
  });

  it('falls back to "the customer" without a name', () => {
    expect(buildContactAskNote({ quoteId: 'q', jobName: 'Job' })).toContain('got a mobile or email for the customer?');
  });
});

describe('the Send card', () => {
  const facts = sendOfferFactsForQuote({
    job: { name: 'Concrete slab — 7x4' },
    customerName: 'Emma',
    customerEmail: ' emma@example.com ',
    customerPhone: '',
    total: 8630.4,
    type: 'quote',
  });

  it('carries the recipient email onto the facts', () => {
    expect(facts.customerEmail).toBe('emma@example.com');
    expect(sendOfferFactsForQuote({ customerPhone: '04' }).customerEmail).toBeUndefined();
  });

  it('is a propose_send_quote the tradie can tap, showing recipient + total', () => {
    const p = buildSendCardProposal({ quoteId: 'q-1', facts, id: 'p-1', createdAt: '2026-09-21T00:00:00.000Z' });
    expect(p).toEqual({
      id: 'p-1',
      toolUseId: `${SEND_CARD_TOOL_USE_PREFIX}q-1`,
      createdAt: '2026-09-21T00:00:00.000Z',
      type: 'propose_send_quote',
      quoteId: 'q-1',
      recipientEmail: 'emma@example.com',
      displayTotal: 8630.4,
    });
  });

  it('leaves the recipient off for a phone-only customer — the sheet routes to SMS', () => {
    const phoneOnly = sendOfferFactsForQuote({ customerName: 'Vai', customerPhone: '0412', total: 100 });
    const p = buildSendCardProposal({ quoteId: 'q-2', facts: phoneOnly, id: 'p', createdAt: 'now' });
    expect(p.recipientEmail).toBeUndefined();
    expect(p.displayTotal).toBe(100);
  });

  it('introduces the card in one line with name and total', () => {
    expect(sendCardLine(facts)).toBe("Emma's quote is ready — $8,630. Send it?");
    expect(sendCardLine({ jobName: 'Job', hasContact: true, docType: 'invoice' })).toBe('That invoice is ready. Send it?');
  });
});

describe('buildSendOfferNote with the card / the earlier ask', () => {
  const withContact = { jobName: 'Slab', customerName: 'Emma', total: 8630, hasContact: true, docType: 'quote' as const };
  const noContact = { jobName: 'Wall', customerName: 'Jobel', total: 17064, hasContact: false, docType: 'quote' as const };

  it('with a card up it is context only: no offer, no second ask', () => {
    const note = buildSendOfferNote(withContact, [], 'q-1', { cardShown: true });
    expect(note).toContain('A Send card is up');
    expect(note).toContain('apply_pending_proposal');
    expect(note).toContain("Don't offer the send again");
    expect(note).not.toContain('Your turn');
    expect(note).not.toContain('want me to send it?');
  });

  it('after a mid-pricing ask it does not ask twice, and names the tool for when the number comes', () => {
    const note = buildSendOfferNote(noContact, [], 'q-9', { contactAsked: true });
    expect(note).toContain("don't ask twice");
    expect(note).toContain('propose_update_customer on q-9');
    expect(note).not.toContain('ask for the customer');
  });

  it('without the flag the no-contact note still asks once', () => {
    expect(buildSendOfferNote(noContact, [], 'q-9')).toContain("ask for the customer's email or mobile");
  });
});

describe('isUnsentSource', () => {
  it('a draft with no send stamp can take a Send card', () => {
    expect(isUnsentSource({})).toBe(true);
    expect(isUnsentSource({ stage: 'draft' })).toBe(true);
    expect(isUnsentSource({ status: 'draft' })).toBe(true);
  });

  it('anything sent, accepted or stamped cannot', () => {
    expect(isUnsentSource({ stage: 'quote_sent' })).toBe(false);
    expect(isUnsentSource({ status: 'sent' })).toBe(false);
    expect(isUnsentSource({ stage: 'draft', sentAt: 1758400000000 })).toBe(false);
  });
});
