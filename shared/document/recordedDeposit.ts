/**
 * How the deposit on a document's ledger reads on the invoice.
 *
 * There are two shapes of deposit on an invoice, and they must never render
 * together:
 *
 *  - LEDGER deposits. A deposit taken on the quote (Square, or recorded by
 *    hand — `kind: 'deposit'`) or a hand-recorded invoice payment labelled as
 *    the deposit (`isDeposit`). The invoice keeps its full total; the deposit
 *    is part of paidTotal and prints as a "Deposit paid" row under it:
 *    TOTAL $960 / Deposit paid −$300 / BALANCE DUE $660.
 *
 *  - A NETTED credit. Invoices minted by the old createInvoiceFromQuote path
 *    stored `total = quote total − deposit` and a `depositCredit` on the
 *    legacy record. The forward projection turns that credit into a
 *    `deposit-credit-{quoteId}` ledger entry (shared/document/adapter.ts).
 *    Its total is already the balance, so it prints as "Deposit already
 *    paid" above a BALANCE DUE equal to the total — and it must not be
 *    counted as paid a second time.
 *
 * The id prefix is the only thing that tells them apart, and it is stable:
 * preserveLedger keeps stored entries (ids included) across every mirror pass.
 */
import type { DocumentPayment } from './types';

/** Id the legacy projection gives a credit already netted off the total. */
export const NETTED_DEPOSIT_CREDIT_ID_PREFIX = 'deposit-credit-';

type DepositLike = Pick<DocumentPayment, 'kind' | 'amount' | 'isDeposit'> & { id?: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Is this entry a legacy credit the invoice total was already reduced by? */
export function isNettedDepositCredit(p: DepositLike | null | undefined): boolean {
  return !!p && p.kind === 'deposit' && String(p.id ?? '').startsWith(NETTED_DEPOSIT_CREDIT_ID_PREFIX);
}

/**
 * The part of the ledger the invoice total was already reduced by — only
 * ever non-zero on a legacy-netted invoice. Renders as the "Deposit already
 * paid" credit and is NOT part of what the customer still owes against.
 */
export function nettedDepositCredit(
  payments: ReadonlyArray<DepositLike> | null | undefined,
): number {
  const total = (payments ?? [])
    .filter(isNettedDepositCredit)
    .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  return round2(total);
}

/**
 * How much of the deposit an invoice's stored total is short by — what has
 * to be added back to get the full job value. A legacy-minted invoice says
 * so through its netted credit. A unified convert made before the convert
 * stopped netting (Oct 2026) carries an ordinary deposit entry, but its undo
 * stash still holds the quote total it was cut from: when the stored total
 * is exactly that less the deposits, it was netted. Anything else — an
 * invoice converted since, or one whose total was edited afterwards — is
 * taken at face value.
 */
export function depositNettedOffTotal(doc: {
  total?: unknown;
  payments?: ReadonlyArray<DepositLike> | null;
  convertedFromQuote?: { total?: unknown } | null;
}): number {
  const legacy = nettedDepositCredit(doc.payments);
  if (legacy > 0) return legacy;
  const deposits = round2(
    (doc.payments ?? [])
      .filter((p) => p?.kind === 'deposit')
      .reduce((acc, p) => acc + (Number(p.amount) || 0), 0),
  );
  const stashTotal = Number(doc.convertedFromQuote?.total);
  if (deposits <= 0 || !Number.isFinite(stashTotal)) return 0;
  return Math.abs(stashTotal - deposits - (Number(doc.total) || 0)) < 0.005 ? deposits : 0;
}

/**
 * How much of an invoice's paid total is the deposit, for the "Deposit paid"
 * row. Quote deposits (`kind: 'deposit'`, any method) count, as do
 * hand-recorded payments the tradie labelled as the deposit. A netted legacy
 * credit is excluded — it has its own "Deposit already paid" row.
 */
export function recordedDepositTotal(
  payments: ReadonlyArray<DepositLike> | null | undefined,
): number {
  const total = (payments ?? [])
    .filter((p) => !!p && !isNettedDepositCredit(p) && (p.kind === 'deposit' || p.isDeposit === true))
    .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  return round2(total);
}

/**
 * The paid figures an invoice PDF prints, from the document's ledger. One
 * helper for the phone's PDF and the server's emailed PDF so the two can never
 * render the same invoice differently.
 *
 *  - Ledger deposit: TOTAL $960 / Deposit paid −$300 / BALANCE DUE $660.
 *  - Legacy netted:  Deposit already paid −$300 / BALANCE DUE $660 (= total),
 *    with the credit kept out of paidAmount so it isn't taken off twice.
 */
export function invoicePdfPaymentFields(doc: {
  paidTotal?: unknown;
  payments?: ReadonlyArray<DepositLike> | null;
}): { paidAmount: number; paidDepositAmount: number; depositCredit?: number } {
  const netted = nettedDepositCredit(doc.payments);
  return {
    paidAmount: round2((Number(doc.paidTotal) || 0) - netted),
    paidDepositAmount: recordedDepositTotal(doc.payments),
    ...(netted > 0 ? { depositCredit: netted } : {}),
  };
}

/**
 * The deposit figures an invoice EMAIL prints. The email's pricing card has
 * one deposit shape — a "Deposit already paid" row above a "Balance due"
 * equal to the figure it is given — so a ledger deposit is presented the
 * same way: the full total less the deposit, with the deposit as the credit.
 * A netted legacy invoice passes through untouched; its total already is the
 * balance. Never both: the ledger deposit is only used when there is no
 * netted credit.
 */
export function invoiceEmailDepositView(input: {
  total: number;
  /** The legacy record's `depositCredit` — netted credits only. */
  nettedCredit?: number;
  payments?: ReadonlyArray<DepositLike> | null;
}): { total: number; depositCredit?: number } {
  const total = Number(input.total) || 0;
  const netted = Number(input.nettedCredit) || 0;
  if (netted > 0) return { total, depositCredit: netted };
  const deposit = Math.min(recordedDepositTotal(input.payments), total);
  if (deposit <= 0) return { total };
  return { total: round2(total - deposit), depositCredit: deposit };
}
