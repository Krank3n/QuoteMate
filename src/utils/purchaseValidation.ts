/**
 * Client-side handling of validateAppleReceipt / validateGoogleReceipt
 * responses (PAY-01).
 *
 * The server now rejects receipts it can't verify (402 RECEIPT_VALIDATION_
 * FAILED) instead of granting Pro. The client must mirror that: local
 * premium is only set when the server confirmed the entitlement — never as
 * a fallback.
 */

export type ReceiptOutcome =
  /** Server verified the receipt and wrote the entitlement. */
  | 'granted'
  /** Server reached a decision: the receipt does not earn Pro. */
  | 'rejected'
  /** Transient failure (5xx / no response) — leave the store transaction
   *  unfinished so it is re-delivered and validation retries later. */
  | 'retry';

export function classifyReceiptResponse(status: number, body: unknown): ReceiptOutcome {
  const data = body as { success?: unknown } | null | undefined;
  if (data && data.success === true) return 'granted';
  if (status >= 500) return 'retry';
  return 'rejected';
}
