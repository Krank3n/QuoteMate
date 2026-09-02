/**
 * 2 Sep 2026 draft audit: 34 drafts applied across 44 Mate conversations and
 * not one send offer, because nothing gave the model a turn after the card
 * landed (text) or let it say the total (voice). These pin the pure half of
 * the fix — when a turn is earned and what the note tells Mate to do.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSendOfferNote,
  formatAudRounded,
  sendOfferFactsForQuote,
  sendOfferLine,
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
