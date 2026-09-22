/**
 * Free-tier delivery gate — the pure half, shared by sendQuoteEmail and
 * sendInvoiceEmail and unit tested on its own.
 *
 * Mirror of `carriesPayableAmount` in src/utils/quoteDeliveryGuard.ts. The
 * client stopped gating plain quotes on 9 Sep 2026 (#175: sending is the
 * activation event, and 8 of 13 tradies who met the gate on a quote gave up),
 * but the server kept refusing EVERY send from a free-plan account without
 * Square. Between 14 and 16 Sep that was 11 refusals across 3 accounts, each
 * surfacing as a "Send Failed" alert with no way forward. The two sides must
 * agree: only a document a Pay Now button could collect on — an invoice, or
 * a quote with a deposit — needs Square on the free plan.
 */

export interface DeliveryGateDoc {
  requireDeposit?: unknown;
  depositPercentage?: unknown;
}

export type DeliveryGateTarget =
  | { kind: 'quote'; doc: DeliveryGateDoc | null | undefined }
  | { kind: 'invoice'; doc?: DeliveryGateDoc | null };

/**
 * Whether the free-tier gate applies to this document at all. An invoice
 * always carries a payable balance; a quote only when it asks for a deposit.
 */
export function freeTierGateApplies(target: DeliveryGateTarget): boolean {
  if (target.kind === 'invoice') return true;
  const doc = target.doc;
  if (!doc) return false;
  return doc.requireDeposit === true && Number(doc.depositPercentage ?? 0) > 0;
}

/** Same wording as the client gate, so the two never disagree in front of a tradie. */
export const FREE_TIER_GATE_MESSAGE =
  'Connect Square to send invoices and deposit quotes on the free plan.';
