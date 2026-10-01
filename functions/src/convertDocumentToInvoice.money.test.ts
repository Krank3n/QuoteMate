/**
 * The server's quote → invoice convert, with a deposit on the quote.
 *
 * It used to set `total = total − depositPaid` while leaving the deposit on
 * the ledger and in paidTotal, so a $960 job with a $300 deposit became an
 * invoice for $660 with $300 paid — $360 owing, the deposit taken off twice.
 * The client's optimistic convert had the same arithmetic; both now go
 * through invoiceMoneyOnConvert.
 *
 * Firestore is an in-memory map: this pins the fields the convert writes.
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
  });
  // Illegal-transition telemetry writes here; nothing to assert on.
  const collection = () => ({ add: async () => ({}) });
  const firestore: any = () => ({ doc, collection });
  firestore.FieldValue = FieldValue;
  return { firestore, initializeApp: vi.fn(), apps: [] };
});

import { convertDocumentToInvoice } from './documentHandlers';

const PATH = 'users/u1/documents/q-coastal';

function seed(payments: any[]) {
  store.clear();
  store.set(PATH, {
    id: 'q-coastal', number: 'QU-21', type: 'quote', stage: 'quote_accepted',
    total: 960, requireDeposit: true, depositAmount: 300, depositPaid: 300,
    payments, paidTotal: 300, balanceDue: 660,
    createdAt: 1, updatedAt: 1, job: { name: 'Coastal Concreting slab' },
  });
}

const run = () =>
  (convertDocumentToInvoice as any).run({ documentId: 'q-coastal', invoiceNumber: 'INV-12' }, { auth: { uid: 'u1' } });

describe('server convertDocumentToInvoice with a deposit', () => {
  for (const method of ['square', 'bank'] as const) {
    it(`a ${method} deposit: total 960, paid 300, balance 660, one deposit entry`, async () => {
      const deposit = {
        id: `deposit-${method}-1`, kind: 'deposit', amount: 300, paidAt: 1, method,
        ...(method === 'square' ? { squarePaymentId: 'sq-1' } : {}),
      };
      seed([deposit]);

      await run();
      const doc = store.get(PATH)!;

      expect(doc.type).toBe('invoice');
      expect(doc.stage).toBe('draft');
      expect(doc.total).toBe(960);
      expect(doc.paidTotal).toBe(300);
      expect(doc.balanceDue).toBe(660);
      expect(doc.payments).toEqual([deposit]);
      // The undo stash still records what the quote was.
      expect(doc.convertedFromQuote).toMatchObject({ number: 'QU-21', total: 960, stage: 'quote_accepted' });
    });
  }

  it('no deposit: the balance is the whole total', async () => {
    seed([]);
    store.set(PATH, { ...store.get(PATH)!, depositPaid: 0, paidTotal: 0, balanceDue: 960 });

    await run();

    expect(store.get(PATH)).toMatchObject({ total: 960, balanceDue: 960 });
  });
});
