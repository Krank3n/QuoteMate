/**
 * Undoing a conversion is a misclick escape hatch, not a general status
 * move. Once an invoice has gone to a customer or taken money it is a
 * financial record they hold a copy of — the correct move there is cancel
 * and re-issue, or a credit note.
 *
 * Every "false" case below is a door that must stay shut. The negative
 * tests are the point of this file.
 */
import { describe, it, expect } from 'vitest';

import { canRevertToQuote } from './revertToQuote';

const STASH = { number: 'QU-178554', total: 1000, stage: 'quote_sent' as const, at: 1_700_000_000_000 };

function freshInvoice(over: Record<string, any> = {}): any {
  return {
    id: 'inv1',
    type: 'invoice',
    stage: 'draft',
    number: 'INV-006',
    total: 900,
    paidTotal: 0,
    payments: [],
    invoicedAt: 1_700_000_001_000,
    convertedFromQuote: STASH,
    ...over,
  };
}

describe('canRevertToQuote — the undo is open', () => {
  it('allows it on an invoice converted a moment ago and untouched since', () => {
    expect(canRevertToQuote(freshInvoice())).toBe(true);
  });

  it('allows it when the quote was sent before conversion but the invoice never was', () => {
    // sentAt predates invoicedAt — that send was the QUOTE going out.
    expect(
      canRevertToQuote(freshInvoice({ sentAt: 1_700_000_000_500 })),
    ).toBe(true);
  });
});

describe('canRevertToQuote — the doors that stay shut', () => {
  it('refuses once the invoice itself has been sent', () => {
    expect(
      canRevertToQuote(freshInvoice({ sentAt: 1_700_000_002_000 })),
    ).toBe(false);
  });

  it('refuses once the invoice has left draft', () => {
    expect(canRevertToQuote(freshInvoice({ stage: 'invoice_sent' }))).toBe(false);
    expect(canRevertToQuote(freshInvoice({ stage: 'partially_paid' }))).toBe(false);
    expect(canRevertToQuote(freshInvoice({ stage: 'paid' }))).toBe(false);
  });

  it('refuses once any money has landed', () => {
    expect(canRevertToQuote(freshInvoice({ paidTotal: 250 }))).toBe(false);
    expect(
      canRevertToQuote(freshInvoice({ payments: [{ id: 'p1', amount: 250 }] })),
    ).toBe(false);
  });

  // A local revert can't reach into Xero, so the two would silently
  // disagree about whether the invoice exists.
  it('refuses once it is live in Xero', () => {
    expect(canRevertToQuote(freshInvoice({ xeroSyncStatus: 'synced' }))).toBe(false);
    expect(canRevertToQuote(freshInvoice({ xeroInvoiceId: 'xero-1' }))).toBe(false);
  });

  it('refuses while a pay link is live — the customer may be mid-checkout', () => {
    expect(
      canRevertToQuote(freshInvoice({ activePaymentLink: { url: 'https://sq/x' } })),
    ).toBe(false);
  });

  it('refuses without a stash, since there is nothing to restore it to', () => {
    expect(canRevertToQuote(freshInvoice({ convertedFromQuote: undefined }))).toBe(false);
  });

  it('refuses on a document that is already a quote', () => {
    expect(canRevertToQuote({ type: 'quote', stage: 'draft' } as any)).toBe(false);
  });

  it('refuses on nothing at all', () => {
    expect(canRevertToQuote(undefined)).toBe(false);
    expect(canRevertToQuote(null)).toBe(false);
  });
});
