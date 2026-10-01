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
 * one deposit shape — a "Deposit already paid" row, then an "Amount paid" row
 * for anything received since, above a "Balance due" equal to the figure it
 * is given. A ledger deposit is presented that way: the full total less the
 * deposit and the later payments. A netted legacy invoice's total is already
 * less its deposit, so only the later payments come off it. Never both
 * shapes: the ledger deposit is only used when there is no netted credit.
 * An invoice with no deposit at all keeps the plain "Total" card (paidTotal
 * isn't shown there, as before).
 */
export function invoiceEmailDepositView(input: {
  total: number;
  /** The legacy record's `depositCredit` — netted credits only. */
  nettedCredit?: number;
  payments?: ReadonlyArray<DepositLike> | null;
  /** Everything paid against the invoice (the ledger sum); 0 when unknown. */
  paidTotal?: number;
}): { total: number; depositCredit?: number; paidCredit?: number } {
  const total = Number(input.total) || 0;
  const netted = Number(input.nettedCredit) || 0;
  const paidTotal = Number(input.paidTotal) || 0;
  if (netted > 0) {
    const paidSince = round2(Math.max(0, paidTotal - netted));
    const shown = Math.min(paidSince, total);
    return {
      total: round2(total - shown),
      depositCredit: netted,
      ...(shown > 0 ? { paidCredit: shown } : {}),
    };
  }
  const deposit = Math.min(recordedDepositTotal(input.payments), total);
  if (deposit <= 0) return { total };
  const paidSince = round2(Math.min(Math.max(0, paidTotal - deposit), total - deposit));
  return {
    total: round2(total - deposit - paidSince),
    depositCredit: deposit,
    ...(paidSince > 0 ? { paidCredit: paidSince } : {}),
  };
}

/**
 * Undo an older app build's netted convert.
 *
 * App builds from before Oct 2026 convert a quote with a deposit by setting
 * the invoice total to `quote total − deposit` AND keeping the deposit on the
 * ledger — and they write that netted total themselves, after the server's
 * full-total convert. Seen on the simulator with a 1.58 store build: a $972.40
 * job with a $291.72 bank deposit became an invoice for $680.68 with $291.72
 * paid and $388.96 owing, $291.72 short.
 *
 * The unified doc keeps the quote total it was converted from
 * (`convertedFromQuote.total`, the undo stash). When the incoming total is
 * exactly that less the ledger's deposits, the deposit was taken off twice —
 * restore the full total and re-derive the balance. Older legacy-minted
 * invoices (a `deposit-credit-*` entry) are meant to be netted and are left
 * alone, as is any total that doesn't match exactly (an edited invoice).
 * Pure.
 */
export function restoreNettedConvertTotal(existing: Record<string, any> | null | undefined, toWrite: Record<string, any>): Record<string, any> {
  if ((toWrite.type ?? existing?.type) !== 'invoice') return toWrite;
  const stashTotal = Number((toWrite.convertedFromQuote ?? existing?.convertedFromQuote)?.total);
  if (!Number.isFinite(stashTotal) || stashTotal <= 0) return toWrite;
  const payments: Record<string, any>[] = Array.isArray(toWrite.payments) ? toWrite.payments : [];
  const isNetted = (p: Record<string, any>) => p?.kind === 'deposit' && String(p?.id ?? '').startsWith('deposit-credit-');
  if (payments.some(isNetted)) return toWrite;
  const deposits = payments
    .filter((p) => p?.kind === 'deposit')
    .reduce((acc, p) => acc + (Number(p?.amount) || 0), 0);
  if (deposits <= 0.005) return toWrite;
  const total = Number(toWrite.total);
  if (!Number.isFinite(total) || Math.abs(stashTotal - deposits - total) >= 0.005) return toWrite;
  const paid = payments.reduce((acc, p) => acc + (Number(p?.amount) || 0), 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const out: Record<string, any> = {
    ...toWrite,
    total: round2(stashTotal),
    balanceDue: round2(Math.max(0, stashTotal - paid)),
  };
  if (toWrite.stage === 'paid' && paid + 0.005 < stashTotal) out.stage = 'partially_paid';
  return out;
}

/**
 * What the customer still owes on an invoice, from the unified document:
 * the full total (after undoing an older build's netted convert) less what
 * has been paid against it — a legacy-minted invoice's netted deposit credit
 * is already off its total, so it doesn't count twice. The one figure the
 * pay link, the reminder email and the link rotation all quote.
 */
export function invoiceBalanceDue(doc: Record<string, any>): number {
  const d = restoreNettedConvertTotal(doc, doc);
  const total = Number(d.total) || 0;
  const paid = (Number(d.paidTotal) || 0) - nettedDepositCredit(d.payments);
  return round2(Math.max(0, total - paid));
}
