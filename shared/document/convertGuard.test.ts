/**
 * Regression tests for the Aug 2026 self-blocking convert.
 *
 * Reproduced twice on a 1.53 build against prod. Cloud Logging pinned the
 * sequence exactly:
 *
 *   01:30:15.515  onQuoteWritten           started    <- client stamped the legacy quote
 *   01:30:15.817  onQuoteWritten           ok         <- mirror put invoicedAt on the DOCUMENT
 *   01:30:21.691  convertDocumentToInvoice started    <- 5.9s later, reads its own residue
 *   01:30:22.197  convertDocumentToInvoice 200        <- "alreadyInvoiced", type never flipped
 *
 * The document was left type 'quote' WITH invoicedAt, which the old
 * canConvert read as "already done" — so both doors vanished and it sent as a
 * quote. Silent, permanent, and intermittent (it depends on whether the
 * mirror beats the RPC).
 */
import { describe, it, expect } from 'vitest';

import {
  isAlreadyInvoiced,
  isSelfStampedConvert,
  canConvertDocument,
  type ConvertCandidate,
} from './convertGuard';

const quote = (over: Partial<ConvertCandidate> = {}): ConvertCandidate =>
  ({ id: 'doc1', type: 'quote', ...over });

describe('isAlreadyInvoiced', () => {
  it('is true only once the document is actually an invoice', () => {
    expect(isAlreadyInvoiced({ id: 'doc1', type: 'invoice' })).toBe(true);
    expect(isAlreadyInvoiced(quote())).toBe(false);
  });

  it('IGNORES invoicedAt on a quote — the bug in one line', () => {
    // This is the residue the convert flow writes about itself. Treating it
    // as "already an invoice" is what made convert a no-op returning 200.
    expect(isAlreadyInvoiced(quote({ invoicedAt: 1755480615817 }))).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(isAlreadyInvoiced(null)).toBe(false);
    expect(isAlreadyInvoiced(undefined)).toBe(false);
  });
});

describe('isSelfStampedConvert', () => {
  it('recognises the stranded document: legacyInvoiceId points at itself', () => {
    expect(
      isSelfStampedConvert(quote({ invoicedAt: 1, legacyInvoiceId: 'doc1' })),
    ).toBe(true);
  });

  it('does NOT claim a quote whose legacy invoice lives at another id', () => {
    // The legacy createInvoiceFromQuote path mints a separate invoice and
    // stamps its id here. Healing this one would bill the customer twice.
    expect(
      isSelfStampedConvert(quote({ invoicedAt: 1, legacyInvoiceId: 'invoice-99' })),
    ).toBe(false);
  });

  it('stays out of it when the link is missing entirely', () => {
    // Ambiguous — could be an old legacy record. Conservative by design.
    expect(isSelfStampedConvert(quote({ invoicedAt: 1 }))).toBe(false);
  });

  it('is false for an untouched quote and for an invoice', () => {
    expect(isSelfStampedConvert(quote())).toBe(false);
    expect(isSelfStampedConvert({ id: 'd', type: 'invoice', invoicedAt: 1 })).toBe(false);
  });
});

describe('canConvertDocument', () => {
  it('offers conversion on a quote at any point in its life', () => {
    expect(canConvertDocument(quote())).toBe(true);
    expect(canConvertDocument(quote({ id: 'x' }))).toBe(true);
  });

  it('re-offers conversion on a document stranded by the race', () => {
    // The whole point: recoverable in-app, no support round-trip.
    expect(
      canConvertDocument(quote({ invoicedAt: 1, legacyInvoiceId: 'doc1' })),
    ).toBe(true);
  });

  it('never re-offers it once the document is an invoice', () => {
    expect(canConvertDocument({ id: 'd', type: 'invoice' })).toBe(false);
  });

  it('never offers it on a quote that already has a real legacy invoice', () => {
    expect(
      canConvertDocument(quote({ invoicedAt: 1, legacyInvoiceId: 'invoice-99' })),
    ).toBe(false);
    expect(canConvertDocument(quote({ invoicedAt: 1 }))).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(canConvertDocument(null)).toBe(false);
    expect(canConvertDocument(undefined)).toBe(false);
  });
});
