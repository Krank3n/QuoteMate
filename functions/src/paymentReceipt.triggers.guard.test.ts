import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Wiring guard for payment receipts. The delivery LOGIC is unit-tested in
 * paymentReceipt.helpers.test.ts, but the "exactly one receipt per payment"
 * guarantee also depends on how index.ts composes those helpers — and index.ts
 * can't be imported in a unit test (it registers triggers and initialises
 * firebase-admin on load). So we assert the composition structurally.
 *
 * These aren't style rules. Each one, if it regressed, would either email a
 * real customer twice for one payment or go back to emailing them nothing:
 *   - the documents trigger must exist, on the unified collection, or
 *     document-only invoices (the default path since Phase 5) send nothing;
 *   - it must be onUpdate — onWrite would fire receipts at every customer
 *     whose invoice gets mirrored or backfilled into `documents`;
 *   - both legacy triggers must defer to it when a mirror exists, or a
 *     dual-written invoice fires both and the customer gets two receipts;
 *   - the send must sit behind the transactional high-water claim.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(HERE, 'index.ts'), 'utf8');

/** The body of a top-level `export const <name> = ...` trigger declaration. */
function triggerBody(name: string): string {
  const start = indexSrc.indexOf(`export const ${name} = functions.firestore`);
  expect(start, `${name} should be declared in index.ts`).toBeGreaterThan(-1);
  const next = indexSrc.indexOf('\nexport const ', start + 1);
  return indexSrc.slice(start, next === -1 ? undefined : next);
}

describe('onDocumentPaymentReceived — receipts reach document-collection invoices', () => {
  const body = triggerBody('onDocumentPaymentReceived');

  it('triggers on the unified documents collection', () => {
    expect(body).toContain("functions.firestore\n  .document('users/{userId}/documents/{docId}')");
  });

  it('is onUpdate, not onWrite — a doc arriving already paid is history, not a payment', () => {
    expect(body).toContain('.onUpdate(');
    expect(body).not.toContain('.onWrite(');
  });

  it('evaluates with the document-shape helper and sends through the shared deliverer', () => {
    expect(body).toContain('evaluateDocumentPaymentReceipt(before, after)');
    expect(body).toContain('deliverPaymentReceipt(');
  });

  it('claims the high-water mark in a transaction before sending', () => {
    expect(body).toContain('db.runTransaction(');
    expect(body).toContain('claimsReceipt(');
    expect(body).toContain('receiptSentPaidCents: receipt.receiptedPaidCents');
    // The send is gated on the claim — never unconditional.
    expect(body).toContain('if (claimed)');
    expect(body.indexOf('claimsReceipt(')).toBeLessThan(body.indexOf('deliverPaymentReceipt('));
  });

  it('pushes the tradie on the stage → paid edge', () => {
    expect(body).toContain('shouldSendInvoicePaidPush(before, after)');
    expect(body).toContain("'invoice_paid'");
  });
});

describe.each(['onInvoicePaymentReceived', 'onInvoiceStatusChanged'])(
  '%s — the legacy trigger defers to the documents trigger',
  (name) => {
    const body = triggerBody(name);

    it('still watches the legacy invoices collection', () => {
      expect(body).toContain("functions.firestore\n  .document('users/{userId}/invoices/{invoiceId}')");
    });

    it('bails out when the invoice has a unified mirror document', () => {
      expect(body).toContain('if (await legacyInvoiceHasMirror(userId, after, invoiceId)) return;');
    });

    it('checks for the mirror BEFORE sending anything', () => {
      const guard = body.indexOf('legacyInvoiceHasMirror');
      const send = Math.min(
        ...[body.indexOf('deliverPaymentReceipt('), body.indexOf('sendAussiePush(')]
          .filter((i) => i > -1),
      );
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(send);
    });
  },
);

describe('legacyInvoiceHasMirror — resolves the mirror id the mirror itself uses', () => {
  it('reuses documentMirror.mirrorIdForInvoice rather than re-deriving the rule', () => {
    expect(indexSrc).toContain("import { mirrorIdForInvoice } from './documentMirror'");
    const start = indexSrc.indexOf('async function legacyInvoiceHasMirror');
    const body = indexSrc.slice(start, indexSrc.indexOf('\n}', start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('mirrorIdForInvoice(invoice, invoiceId)');
    expect(body).toContain('users/${userId}/documents/${mirrorId}');
  });
});
