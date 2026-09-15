/**
 * Un-paying an invoice must actually clear its settlement stamp in Firestore.
 *
 * saveDocument writes with { merge: true } after stripUndefined, so the
 * `paidInFullAt: undefined` the un-pay path sets was silently dropped and the
 * old stamp survived. INV-017 (paid on the 13th, un-paid, paid again on the
 * 15th) printed "Paid 13 September" on a payment recorded on the 15th.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fs = vi.hoisted(() => ({
  setDoc: vi.fn(async () => {}),
  DELETE: { __sentinel: 'deleteField' },
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((_db: any, ...path: string[]) => ({ path: path.join('/') })),
  setDoc: fs.setDoc,
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: () => fs.DELETE,
  updateDoc: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));
vi.mock('../config/firebase', () => ({ auth: { currentUser: { uid: 'u1' } }, db: {} }));

import { documentService } from './documentService';

const base: any = {
  id: 'doc-1', number: 'INV-017', type: 'invoice', stage: 'invoice_sent',
  createdAt: 1, updatedAt: 2, payments: [], paidTotal: 0, balanceDue: 685.85, total: 685.85,
  materials: [], sections: [], laborHours: 0, laborRate: 0, laborTotal: 0,
  subtotal: 623.5, gst: 62.35, customerName: 'Sam Testerson', job: { name: 'Custom Job', description: '' },
};

const unifiedPayload = () => fs.setDoc.mock.calls.find((c: any[]) => c[0].path === 'users/u1/documents/doc-1')![1];

beforeEach(() => fs.setDoc.mockClear());

describe('saveDocument clears paidInFullAt on the way out of paid', () => {
  it('writes a delete sentinel when the store un-pays the invoice', async () => {
    await documentService.saveDocument({ ...base, paidInFullAt: undefined });
    expect(unifiedPayload().paidInFullAt).toBe(fs.DELETE);
  });

  it('keeps the stamp when the invoice is paid', async () => {
    await documentService.saveDocument({ ...base, stage: 'paid', paidInFullAt: 1_757_000_000_000 });
    expect(unifiedPayload().paidInFullAt).toBe(1_757_000_000_000);
  });

  it('leaves the field alone when the document never mentions it', async () => {
    await documentService.saveDocument({ ...base });
    expect('paidInFullAt' in unifiedPayload()).toBe(false);
  });
});
