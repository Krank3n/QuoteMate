/**
 * Apple review requirement 5.10: when an in-person card payment is declined,
 * the customer must still be offered a digital record of the attempt.
 *
 * A decline is the case where the customer most needs something in writing —
 * their bank may show a pending authorisation that later disappears, and the
 * only reassurance they have is a record saying no money was taken. Success is
 * already covered by Square's own receipt screen.
 *
 * Deliberately plain text, so the existing native share sheet can carry it by
 * SMS, email or WhatsApp with no new backend, screen or setting. The tradie's
 * business name is the only sender identity on it — a customer-facing artifact
 * never mentions the app.
 */

import { formatCurrency } from './quoteCalculator';

export interface DeclineRecordInput {
  /** The tradie's business name. The only identity shown to the customer. */
  businessName?: string | null;
  /** Invoice number, or the job name when there is no invoice. */
  reference?: string | null;
  /** Amount that was attempted, in dollars. */
  amount: number;
  /** Defaults to now. Injectable so the text is testable. */
  at?: Date;
}

function formatWhen(at: Date): string {
  // en-AU: "3 Sep 2026, 9:41 am" — the format a tradie would write by hand.
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
 * Build the record the customer receives. Every line is a fact about the
 * attempt — nothing is inferred about why the card was declined, because the
 * app is not told and guessing at someone's bank is not ours to do.
 */
export function buildDeclineRecord({
  businessName,
  reference,
  amount,
  at = new Date(),
}: DeclineRecordInput): string {
  const lines: string[] = [];

  const name = (businessName || '').trim();
  if (name) lines.push(name);

  lines.push('Card payment declined — no money was taken.');
  lines.push('');

  const ref = (reference || '').trim();
  if (ref) lines.push(`For: ${ref}`);
  lines.push(`Amount attempted: ${formatCurrency(amount)}`);
  lines.push(`When: ${formatWhen(at)}`);
  lines.push('');
  lines.push('Nothing has been charged to the card. Please try another card or');
  lines.push('payment method.');

  return lines.join('\n');
}
