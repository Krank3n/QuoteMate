import { describe, it, expect } from 'vitest';
import {
  depositNettedOffTotal,
  invoiceEmailDepositView,
  nettedDepositCredit,
  recordedDepositTotal,
} from './recordedDeposit';

describe('recordedDepositTotal', () => {
  it('sums only the payments marked as the deposit', () => {
    expect(
      recordedDepositTotal([
        { kind: 'manual', amount: 3000, isDeposit: true },
        { kind: 'manual', amount: 500 },
        { kind: 'manual', amount: 250, isDeposit: false },
      ]),
    ).toBe(3000);
  });

  // A quote deposit now rides into the invoice on the ledger against the full
  // total, so it IS the "Deposit paid" row — any method, Square or bank.
  it('counts a quote deposit (kind deposit), whatever the method', () => {
    expect(
      recordedDepositTotal([
        { id: 'deposit-sq-1', kind: 'deposit', amount: 300 },
        { id: 'dep-bank-1', kind: 'deposit', amount: 100 },
        { kind: 'manual', amount: 500 },
      ]),
    ).toBe(400);
  });

  it('leaves out a legacy netted credit — it has its own "Deposit already paid" row', () => {
    expect(
      recordedDepositTotal([{ id: 'deposit-credit-q-1', kind: 'deposit', amount: 300 }]),
    ).toBe(0);
  });

  it('cent-rounds the sum', () => {
    expect(
      recordedDepositTotal([
        { kind: 'manual', amount: 0.1, isDeposit: true },
        { kind: 'manual', amount: 0.2, isDeposit: true },
      ]),
    ).toBe(0.3);
  });

  it('is zero with no payments', () => {
    expect(recordedDepositTotal(undefined)).toBe(0);
    expect(recordedDepositTotal([])).toBe(0);
  });
});

describe('nettedDepositCredit', () => {
  it('sums only the credits a legacy-minted invoice was netted by', () => {
    expect(
      nettedDepositCredit([
        { id: 'deposit-credit-q-1', kind: 'deposit', amount: 300 },
        { id: 'deposit-sq-1', kind: 'deposit', amount: 50 },
        { id: 'manual-1', kind: 'manual', amount: 100 },
      ]),
    ).toBe(300);
  });

  it('is zero for an invoice from the unified convert', () => {
    expect(nettedDepositCredit([{ id: 'deposit-sq-1', kind: 'deposit', amount: 300 }])).toBe(0);
    expect(nettedDepositCredit(undefined)).toBe(0);
  });
});

describe('depositNettedOffTotal', () => {
  const deposit = { id: 'deposit-sq-1', kind: 'deposit' as const, amount: 300 };

  it('an invoice converted since the fix (full total) has nothing to add back', () => {
    expect(depositNettedOffTotal({ total: 960, payments: [deposit], convertedFromQuote: { total: 960 } })).toBe(0);
  });

  it('a legacy-minted invoice adds back its netted credit', () => {
    expect(
      depositNettedOffTotal({ total: 660, payments: [{ id: 'deposit-credit-q-1', kind: 'deposit', amount: 300 }] }),
    ).toBe(300);
  });

  it('an invoice the old convert netted is recognised by its undo stash', () => {
    expect(depositNettedOffTotal({ total: 660, payments: [deposit], convertedFromQuote: { total: 960 } })).toBe(300);
  });

  it('an invoice edited since conversion is taken at face value', () => {
    expect(depositNettedOffTotal({ total: 700, payments: [deposit], convertedFromQuote: { total: 960 } })).toBe(0);
    expect(depositNettedOffTotal({ total: 660, payments: [deposit] })).toBe(0);
  });
});

describe('invoiceEmailDepositView', () => {
  it('a ledger deposit reads as a credit above the balance: $960 job, $300 deposit → $660 due', () => {
    expect(
      invoiceEmailDepositView({ total: 960, payments: [{ id: 'dep-bank-1', kind: 'deposit', amount: 300 }] }),
    ).toEqual({ total: 660, depositCredit: 300 });
  });

  it('a legacy-netted invoice passes through untouched — its total already is the balance', () => {
    expect(
      invoiceEmailDepositView({
        total: 660,
        nettedCredit: 300,
        payments: [{ id: 'deposit-credit-q-1', kind: 'deposit', amount: 300 }],
      }),
    ).toEqual({ total: 660, depositCredit: 300 });
  });

  it('no deposit, no credit', () => {
    expect(invoiceEmailDepositView({ total: 960, payments: [{ kind: 'manual', amount: 100 }] })).toEqual({ total: 960 });
  });
});

// Both PDFs (the phone's and the emailed one) and the invoice email must read
// the deposit through these helpers. A unit test on the helper can't catch a
// call site going back to hand-rolled arithmetic, so this reads the sources.
describe('every invoice render path reads the deposit through the shared helpers', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('path') as typeof import('path');
  const root = join(__dirname, '..', '..');
  const client = readFileSync(join(root, 'src/utils/pdfGenerator.ts'), 'utf8');
  const server = readFileSync(join(root, 'functions/src/documentHandlers.ts'), 'utf8');

  it('the phone PDF uses invoicePdfPaymentFields', () => {
    expect(client).toContain('...invoicePdfPaymentFields(doc)');
  });

  it('the emailed PDF uses invoicePdfPaymentFields and the email uses invoiceEmailDepositView', () => {
    expect(server).toContain('...invoicePdfPaymentFields(doc as DocumentRecord)');
    expect(server).toContain('invoiceEmailDepositView({');
    expect(server).toContain('depositCredit: emailDeposit.depositCredit');
  });
});
