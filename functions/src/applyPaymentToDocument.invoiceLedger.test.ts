/**
 * A Square payment landing on a part-paid invoice must not flatten the
 * payments already on it. The webhook writes the unified ledger FIRST and the
 * legacy invoice second; the legacy write's mirror echo then sums to the same
 * money and preserveLedger keeps every entry. In the old order the echo
 * arrived first and replaced the ledger with one combined entry.
 *
 * Firestore is an in-memory map.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, Record<string, any>>() }));

vi.mock('firebase-admin', () => {
  class FieldValue {
    constructor(public readonly op: string) {}
    static delete() { return new FieldValue('delete'); }
    static serverTimestamp() { return new FieldValue('serverTimestamp'); }
    static arrayUnion(..._v: unknown[]) { return new FieldValue('arrayUnion'); }
    static increment(_n: number) { return new FieldValue('increment'); }
  }
  const doc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    async get() {
      const data = store.get(path);
      return { exists: data !== undefined, id: path.split('/').pop(), data: () => data };
    },
    async set(data: Record<string, any>, opts?: { merge?: boolean }) {
      const next: Record<string, any> = opts?.merge ? { ...(store.get(path) ?? {}) } : {};
      for (const [k, v] of Object.entries(data)) {
        if (v instanceof FieldValue && v.op === 'delete') delete next[k];
        else next[k] = v;
      }
      store.set(path, next);
    },
    async update(data: Record<string, any>) {
      await this.set(data, { merge: true });
    },
  });
  const firestore: any = () => ({ doc });
  firestore.FieldValue = FieldValue;
  return { firestore, initializeApp: vi.fn(), apps: [] };
});

import { applyPaymentToDocument } from './documentHandlers';
import { preserveLedger } from './documentMirror';
import { invoiceRecordToDocumentRecord } from './shared/document/adapter';

const manual = [
  { id: 'p1', kind: 'manual', amount: 3000, method: 'bank', paidAt: 1, isDeposit: true },
  { id: 'p2', kind: 'manual', amount: 500, method: 'cash', paidAt: 2 },
];

function seedInvoice(over: Record<string, any> = {}) {
  store.clear();
  store.set('users/u1/documents/inv1', {
    id: 'inv1', number: 'INV-1', type: 'invoice', stage: 'partially_paid',
    total: 9850.4, paidTotal: 3500, balanceDue: 6350.4, payments: manual,
    createdAt: 1, updatedAt: 1,
    ...over,
  });
}

function squarePayment(amountCents: number) {
  return applyPaymentToDocument({
    userId: 'u1', paymentId: 'SQ-1', orderId: 'ORD-1', amountCents,
    source: 'pay_link' as const, kind: 'invoice', invoiceId: 'inv1',
  });
}

describe('applyPaymentToDocument — Square payment on a part-paid invoice', () => {
  beforeEach(() => seedInvoice());

  it('appends the Square payment and keeps every earlier entry', async () => {
    await squarePayment(200_000);
    const doc = store.get('users/u1/documents/inv1')!;
    expect(doc.payments.map((p: any) => p.id)).toEqual(['p1', 'p2', 'square-SQ-1']);
    expect(doc.paidTotal).toBeCloseTo(5500);
    expect(doc.stage).toBe('partially_paid');
  });

  it('the legacy echo that follows keeps the full ledger, deposit label included', async () => {
    await squarePayment(200_000);
    const stored = store.get('users/u1/documents/inv1')!;
    // What the webhook then writes to invoices/inv1, projected back by the
    // mirror trigger: one Square-shaped entry carrying the whole paid total.
    const echo = invoiceRecordToDocumentRecord(
      { id: 'inv1', invoiceNumber: 'INV-1', total: 9850.4, paidAmount: 5500, status: 'partial',
        squarePaymentId: 'SQ-1', paymentMethod: 'card', createdAt: 1, updatedAt: 2 } as any,
      'inv1',
    ) as any;
    expect(echo.payments).toHaveLength(1);

    const written = preserveLedger(stored, echo);
    expect(written.payments.map((p: any) => p.id)).toEqual(['p1', 'p2', 'square-SQ-1']);
    expect(written.payments[0].isDeposit).toBe(true);
  });

  it('a webhook redelivery does not add the payment twice', async () => {
    await squarePayment(200_000);
    await squarePayment(200_000);
    expect(store.get('users/u1/documents/inv1')!.payments).toHaveLength(3);
  });

  it('writes nothing for an older converted invoice whose document lives under its quote id', async () => {
    store.clear();
    store.set('users/u1/invoices/inv1', {
      id: 'inv1', invoiceNumber: 'INV-1', total: 9850.4, paidAmount: 3500,
      status: 'partial', sourceQuoteId: 'q1', createdAt: 1, updatedAt: 1,
    });
    await squarePayment(200_000);
    expect(store.has('users/u1/documents/inv1')).toBe(false);
  });
});
