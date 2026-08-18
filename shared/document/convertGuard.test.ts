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
 * The document was left type 'quote' WITH invoicedAt, so the UI read it as
 * "already done" — both doors vanished and it sent as a quote. Silent,
 * permanent, and intermittent (it depends on whether the mirror beats the RPC).
 */
import { describe, it, expect } from 'vitest';

import {
  isAlreadyInvoiced,
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

  it('is unmoved by a legacy pointer, resolvable or not', () => {
    expect(isAlreadyInvoiced(quote({ invoicedAt: 1, legacyInvoiceId: 'doc1' }))).toBe(false);
    expect(isAlreadyInvoiced(quote({ invoicedAt: 1, legacyInvoiceId: 'gone' }))).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(isAlreadyInvoiced(null)).toBe(false);
    expect(isAlreadyInvoiced(undefined)).toBe(false);
  });
});

describe('canConvertDocument', () => {
  it('offers conversion on a quote at any point in its life', () => {
    expect(canConvertDocument(quote())).toBe(true);
    expect(canConvertDocument(quote({ id: 'x' }))).toBe(true);
  });

  it('never re-offers it once the document is an invoice', () => {
    expect(canConvertDocument({ id: 'd', type: 'invoice' })).toBe(false);
  });

  it('never re-offers it on a quote that has already been invoiced', () => {
    // One-way action. Whether the pointer still resolves is not this
    // predicate's business — a stranded document is a repair job, and
    // offering convert on a quote that DOES have an invoice would bill twice.
    expect(canConvertDocument(quote({ invoicedAt: 1, legacyInvoiceId: 'invoice-99' }))).toBe(false);
    expect(canConvertDocument(quote({ invoicedAt: 1, legacyInvoiceId: 'doc1' }))).toBe(false);
    expect(canConvertDocument(quote({ invoicedAt: 1 }))).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(canConvertDocument(null)).toBe(false);
    expect(canConvertDocument(undefined)).toBe(false);
  });
});
