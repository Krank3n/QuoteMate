/**
 * Canonical copy for payment surfaces.
 *
 * One label per concept, everywhere money is collected or logged:
 *  - "Take Payment" (variants "Take Deposit" / "Take Remaining") = collect
 *    now, by card or Square pay link.
 *  - "Record Payment" = log money already received outside the app. Never
 *    "Log Payment" or "Record a payment".
 *  - "Cancel" aborts an in-progress choice or form; "Close" ends an
 *    informational view. No "Later" / "Not now" on payment surfaces.
 */

export const paymentCopy = {
  takePayment: 'Take Payment',
  takeDeposit: 'Take Deposit',
  takeRemaining: 'Take Remaining',
  recordPayment: 'Record Payment',
  recordPaymentSubtitle: "Bank transfer, cash or cheque you've already received.",
  cancel: 'Cancel',
  close: 'Close',
  // Dialog titles — success is specific about what happened, errors share one
  // title so tradies learn a single "something went wrong with money" signal.
  paymentReceivedTitle: 'Payment received',
  paymentRecordedTitle: 'Payment recorded',
  paymentUpdatedTitle: 'Payment updated',
  paymentErrorTitle: 'Payment error',
} as const;
