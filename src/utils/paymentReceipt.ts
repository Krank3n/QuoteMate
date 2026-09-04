/**
 * Apple review requirement 5.10, approved half:
 *
 *   "Regardless of whether a transaction is approved or declined, it must be
 *    possible to send a confidential digital receipt to the customer. This
 *    could be done via SMS, email, QR code, or Activity views."
 *
 * The declined half lives in `paymentDeclineRecord`. This is its twin, and it
 * exists because reviewing the checkout footage showed what the code already
 * said: after an approved in-person payment the app announced "Payment
 * received" and returned to the job, offering the customer nothing. Square's
 * SDK does not present a receipt screen of its own on this path, so assuming it
 * did was wrong.
 *
 * Delivered through the same native share sheet as the decline record — an
 * "Activity view" in Apple's list of acceptable methods, and the one that needs
 * no new backend, screen or setting.
 */

import { formatCurrency } from './quoteCalculator';

export interface PaymentReceiptInput {
  /** The tradie's business name. The only identity a customer should see. */
  businessName?: string | null;
  /** Invoice number, or the job name when there is no invoice. */
  reference?: string | null;
  /** Amount actually charged, in dollars. */
  amount: number;
  /** Defaults to now. Injectable so the text is testable. */
  at?: Date;
}

function formatWhen(at: Date): string {
  const date = at.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = at
    .toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase();
  return `${date}, ${time}`;
}

/**
 * Build the receipt the customer receives.
 *
 * "Confidential" in the requirement is the constraint that shapes this: it
 * carries no card number, no last four, and nothing about the payment
 * instrument — the app is never given those, and a receipt is not the place to
 * start. What it proves is that this business took this amount at this time.
 */
export function buildPaymentReceipt({
  businessName,
  reference,
  amount,
  at = new Date(),
}: PaymentReceiptInput): string {
  const lines: string[] = [];

  const name = (businessName || '').trim();
  if (name) lines.push(name);

  lines.push('Payment received — thanks.');
  lines.push('');

  const ref = (reference || '').trim();
  if (ref) lines.push(`For: ${ref}`);
  lines.push(`Amount paid: ${formatCurrency(amount)}`);
  lines.push(`Paid by: card`);
  lines.push(`When: ${formatWhen(at)}`);

  return lines.join('\n');
}
