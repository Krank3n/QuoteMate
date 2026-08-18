/**
 * Source guard: the convert idempotency check must stay keyed on TYPE.
 *
 * The original condition — `existing.type === 'invoice' || existing.invoicedAt`
 * — made convertDocumentToInvoice refuse work its own caller had just set up,
 * because the client stamps `invoicedAt` on the legacy quote and the mirror
 * lands it on the still-quote document seconds before the RPC reads it. The
 * call returned 200 "alreadyInvoiced" and the type never flipped, stranding
 * the document as a quote that could never be converted again.
 *
 * A unit test on the predicate can't catch a re-inlined condition here, so
 * this reads the source. See shared/document/convertGuard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, 'documentHandlers.ts'), 'utf8');

describe('convertDocumentToInvoice idempotency guard', () => {
  it('uses the shared predicate rather than an inline condition', () => {
    expect(SRC).toContain('isAlreadyInvoiced(');
    expect(SRC).toContain("from './shared/document/convertGuard'");
  });

  it('never re-introduces invoicedAt as an "already an invoice" signal', () => {
    // The exact shape of the bug, in any spacing arrangement.
    const reinlined = /type\s*===\s*['"]invoice['"]\s*\|\|\s*\w+\.invoicedAt/;
    expect(reinlined.test(SRC)).toBe(false);
  });
});
