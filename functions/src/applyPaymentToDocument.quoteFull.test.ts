/**
 * Where a quote lands after the customer pays the whole amount from the
 * acceptance page ("Pay now"). The Square webhook routes a quote_full payment
 * through applyPaymentToDocument: the money lands on the ledger as a Square
 * balance payment, the balance reads zero, and the document stays at
 * quote_accepted — the same state the tradie-side "Full amount" link has
 * always produced. (A quote reaching `paid` directly was tried and reverted:
 * the client has no handling for a paid quote — the status sheet grew a dead
 * "Mark as Paid" row and the job screen lost its action bar.)
 *
 * Firestore is an in-memory map: this is about the ledger arithmetic and
 * the stage the doc ends up in, not about Firestore.
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

function seed(over: Record<string, any> = {}) {
  store.clear();
  store.set('users/u1/documents/q1', {
    id: 'q1', number: 'QU-1', type: 'quote', stage: 'quote_accepted',
    total: 1000, paidTotal: 0, balanceDue: 1000, payments: [], jobId: 'j1',
    activePaymentLink: { id: 'L1', url: 'https://square.link/u/x', kind: 'quote_full', amount: 1000, createdAt: 1 },
    createdAt: 1, updatedAt: 1,
    ...over,
  });
  store.set('users/u1/jobs/j1', { id: 'j1', stage: 'accepted' });
}

function fullPayment(amountCents: number, paymentId = 'PAY-1') {
  return applyPaymentToDocument({
    userId: 'u1', paymentId, orderId: 'ORD-1', amountCents,
    source: 'pay_link' as const, kind: 'quote_full', quoteId: 'q1',
  });
}

describe('applyPaymentToDocument — quote_full from the acceptance page', () => {
  beforeEach(() => seed());

  it('a full payment on an accepted quote lands on the ledger: zero balance, Square on the ledger, still accepted', async () => {
    await fullPayment(100_000);
    const doc = store.get('users/u1/documents/q1')!;
    expect(doc.stage).toBe('quote_accepted');
    expect(doc.paidTotal).toBe(1000);
    expect(doc.balanceDue).toBe(0);
    expect(doc.payments).toHaveLength(1);
    // method: 'square' + squarePaymentId is what docHasRealSquarePayment /
    // nextBestAction read to stop asking the tradie to collect the deposit.
    expect(doc.payments[0]).toMatchObject({
      id: 'full-PAY-1', kind: 'balance', amount: 1000, method: 'square', squarePaymentId: 'PAY-1',
    });
    expect(doc.activePaymentLink.consumedAt).toBeGreaterThan(0);
  });

  it('the Job stays accepted — the invoice is still the tradie\'s step', async () => {
    await fullPayment(100_000);
    expect(store.get('users/u1/jobs/j1')!.stage).toBe('accepted');
  });

  it('paying the full amount straight off a sent quote is the acceptance', async () => {
    seed({ stage: 'quote_sent' });
    await fullPayment(100_000);
    expect(store.get('users/u1/documents/q1')!.stage).toBe('quote_accepted');
    expect(store.get('users/u1/jobs/j1')!.stage).toBe('accepted');
  });

  it('caps an overpayment at the total rather than reporting overpaid', async () => {
    await fullPayment(102_900);
    const doc = store.get('users/u1/documents/q1')!;
    expect(doc.paidTotal).toBe(1000);
    expect(doc.balanceDue).toBe(0);
  });

  it('a short payment still counts as acceptance', async () => {
    seed({ stage: 'quote_sent' });
    await fullPayment(40_000);
    const doc = store.get('users/u1/documents/q1')!;
    expect(doc.stage).toBe('quote_accepted');
    expect(doc.paidTotal).toBe(400);
    expect(doc.balanceDue).toBe(600);
    expect(store.get('users/u1/jobs/j1')!.stage).toBe('accepted');
  });

  it('a deposit is unchanged: accepted, not settled', async () => {
    seed({ stage: 'quote_sent', depositAmount: 250, activePaymentLink: undefined });
    await applyPaymentToDocument({
      userId: 'u1', paymentId: 'PAY-D', orderId: 'ORD-D', amountCents: 25_000,
      source: 'pay_link', kind: 'quote_deposit', quoteId: 'q1',
    });
    const doc = store.get('users/u1/documents/q1')!;
    expect(doc.stage).toBe('quote_accepted');
    expect(doc.payments[0]).toMatchObject({ kind: 'deposit', amount: 250, method: 'square' });
    expect(doc.balanceDue).toBe(750);
  });

  it('a redelivered webhook does not apply the same payment twice', async () => {
    await fullPayment(100_000);
    await fullPayment(100_000);
    const doc = store.get('users/u1/documents/q1')!;
    expect(doc.payments).toHaveLength(1);
    expect(doc.paidTotal).toBe(1000);
  });
});
