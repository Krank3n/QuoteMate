import { describe, it, expect } from 'vitest';
import { preserveFirstSend, preserveLedger } from './documentMirror';

describe('preserveFirstSend', () => {
  it('drops sentAt+sendMethod when existing.sentAt set', () => {
    const existing = { sentAt: 100, sendMethod: 'email' };
    const toWrite = { sentAt: 200, sendMethod: 'sms', stage: 'quote_sent', total: 500 };
    const result = preserveFirstSend(existing, toWrite);

    expect(result.sentAt).toBeUndefined();
    expect(result.sendMethod).toBeUndefined();
    // Everything else survives untouched.
    expect(result.stage).toBe('quote_sent');
    expect(result.total).toBe(500);
  });

  it('passes through when existing has none / existing null', () => {
    const toWrite = { sentAt: 200, sendMethod: 'sms', stage: 'quote_sent' };

    // Existing mirror without a sentAt yet — the first send should record.
    expect(preserveFirstSend({ stage: 'draft' }, toWrite)).toEqual(toWrite);
    // No existing mirror at all.
    expect(preserveFirstSend(null, toWrite)).toEqual(toWrite);
    expect(preserveFirstSend(undefined, toWrite)).toEqual(toWrite);
  });
});

describe('preserveLedger', () => {
  const ledger = [
    { id: 'p1', kind: 'manual', amount: 100, method: 'cash', paidAt: 1 },
    { id: 'p2', kind: 'manual', amount: 50, method: 'bank', paidAt: 2, isDeposit: true },
  ];
  // What invoiceRecordToDocumentRecord rebuilds from the legacy record after
  // a unified save: one entry carrying the summed paidAmount.
  const echo = {
    paidTotal: 150,
    payments: [{ id: 'manual-inv-1', kind: 'manual', amount: 150, method: 'cash', paidAt: 2 }],
    stage: 'partially_paid',
  };

  it('keeps the stored ledger when the legacy echo carries the same money', () => {
    const result = preserveLedger({ payments: ledger }, echo);
    expect(result.payments).toEqual(ledger);
    // Only the ledger is swapped; the rest of the projection still lands.
    expect(result.stage).toBe('partially_paid');
    expect(result.paidTotal).toBe(150);
  });

  it('tolerates float noise in the sums', () => {
    const stored = [
      { id: 'a', amount: 0.1 },
      { id: 'b', amount: 0.2 },
    ];
    const result = preserveLedger({ payments: stored }, { payments: [{ id: 'm', amount: 0.3 }] });
    expect(result.payments).toEqual(stored);
  });

  it('takes the projection when an older client changed the money', () => {
    const changed = { ...echo, paidTotal: 400, payments: [{ id: 'manual-inv-1', amount: 400 }] };
    expect(preserveLedger({ payments: ledger }, changed)).toEqual(changed);
  });

  it('takes the projection when every payment was removed through the legacy record', () => {
    const cleared = { paidTotal: 0, payments: [] };
    expect(preserveLedger({ payments: ledger }, cleared)).toEqual(cleared);
  });

  it('passes through when nothing is stored yet', () => {
    expect(preserveLedger({ payments: [] }, echo)).toEqual(echo);
    expect(preserveLedger({}, echo)).toEqual(echo);
    expect(preserveLedger(null, echo)).toEqual(echo);
  });
});
