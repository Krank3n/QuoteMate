/**
 * How much of an invoice's paid total the tradie recorded as the deposit.
 *
 * Only hand-recorded payments carry the label (see DocumentPayment.isDeposit).
 * A Square quote deposit (`kind: 'deposit'`) is excluded: it already renders
 * as its own "Deposit already paid" credit, and counting it here would show
 * the same money twice.
 */
import type { DocumentPayment } from './types';

export function recordedDepositTotal(
  payments: ReadonlyArray<Pick<DocumentPayment, 'kind' | 'amount' | 'isDeposit'>> | null | undefined,
): number {
  const total = (payments ?? [])
    .filter((p) => p?.isDeposit === true && p.kind !== 'deposit')
    .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  return Math.round(total * 100) / 100;
}
