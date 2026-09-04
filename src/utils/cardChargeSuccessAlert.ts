/**
 * The "Payment received" dialog, in one place.
 *
 * Apple req 5.10 requires that a customer can be sent a digital receipt after
 * an approved transaction, not just a declined one. Three screens each built
 * their own copy of this alert — ViewJobScreen, JobPreviewScreen and
 * useJobActionsSheet — and a Required behaviour wired into two of the three is
 * a review failure on whichever one the reviewer happens to open.
 *
 * So the alert is assembled here and the screens just show it. Adding the
 * receipt in one place makes it impossible to have it in only some.
 */

import type { AlertModalOptions } from '../hooks/useAlertModal';
import { paymentCopy } from '../constants/paymentCopy';
import { formatCurrency } from './quoteCalculator';

export interface CardChargeSuccess {
  /** Amount charged, in dollars. */
  amount: number;
  /**
   * Shares the receipt with the customer. Omitted when there is nothing to
   * send — the alert then simply has no receipt action rather than a button
   * that does nothing.
   */
  sendReceipt?: () => void | Promise<void>;
}

export function cardChargeSuccessAlert({
  amount,
  sendReceipt,
}: CardChargeSuccess): AlertModalOptions {
  return {
    type: 'success',
    title: paymentCopy.paymentReceivedTitle,
    message: `${formatCurrency(amount)} charged to card.`,
    // "Done" stays the primary action: the money is already taken, and the
    // receipt is an offer rather than a step the tradie must complete.
    primaryButtonText: paymentCopy.done,
    ...(sendReceipt
      ? {
          secondaryButtonText: paymentCopy.sendReceipt,
          secondaryButtonAction: sendReceipt,
        }
      : {}),
  };
}
