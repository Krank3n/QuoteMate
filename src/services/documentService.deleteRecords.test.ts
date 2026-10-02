import { describe, it, expect, vi, beforeEach } from 'vitest';

const deleted: string[] = [];
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  deleteDoc: vi.fn(async (p: string) => { deleted.push(p); }),
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), onSnapshot: vi.fn(),
  getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), where: vi.fn(),
  deleteField: vi.fn(), serverTimestamp: vi.fn(),
}));
vi.mock('../config/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));

import { documentService } from './documentService';

beforeEach(() => { deleted.length = 0; });

describe('documentService.deleteDocumentRecords', () => {
  it('removes the quote and invoice copies and the document, the document last', async () => {
    await documentService.deleteDocumentRecords({ id: 'q-1', legacyQuoteId: 'q-1', legacyInvoiceId: 'q-1' });
    expect(new Set(deleted.slice(0, -1))).toEqual(new Set(['users/u1/quotes/q-1', 'users/u1/invoices/q-1']));
    expect(deleted.at(-1)).toBe('users/u1/documents/q-1');
  });

  it('an older invoice under its own id: both legacy ids go', async () => {
    await documentService.deleteDocumentRecords({ id: 'q-2', legacyQuoteId: 'q-2', legacyInvoiceId: 'inv-9' });
    expect(deleted).toEqual(expect.arrayContaining([
      'users/u1/quotes/q-2', 'users/u1/invoices/q-2', 'users/u1/invoices/inv-9', 'users/u1/documents/q-2',
    ]));
    expect(deleted.at(-1)).toBe('users/u1/documents/q-2');
  });
});
