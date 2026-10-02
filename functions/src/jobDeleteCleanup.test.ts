import { describe, it, expect } from 'vitest';
import { planOrphanCleanup } from './jobDeleteCleanup';

describe('planOrphanCleanup', () => {
  it('removes a converted invoice with no money, its quote and invoice copies first', () => {
    const plan = planOrphanCleanup('u1', [{ id: 'q-1', data: { type: 'invoice', legacyQuoteId: 'q-1', paidTotal: 0, payments: [] } }]);
    expect(plan.remove).toEqual([{ id: 'q-1', legacyPaths: ['users/u1/quotes/q-1', 'users/u1/invoices/q-1'] }]);
    expect(plan.keptWithMoney).toEqual([]);
  });

  it('includes an older invoice\'s separate legacy invoice id', () => {
    const plan = planOrphanCleanup('u1', [{ id: 'q-2', data: { legacyQuoteId: 'q-2', legacyInvoiceId: 'inv-9' } }]);
    expect(plan.remove[0].legacyPaths).toEqual(['users/u1/quotes/q-2', 'users/u1/invoices/q-2', 'users/u1/invoices/inv-9']);
  });

  it('never removes a document with money on it', () => {
    const plan = planOrphanCleanup('u1', [
      { id: 'paid', data: { paidTotal: 4312 } },
      { id: 'deposit', data: { paidTotal: 0, payments: [{ amount: 300 }] } },
      { id: 'clean', data: {} },
    ]);
    expect(plan.keptWithMoney).toEqual(['paid', 'deposit']);
    expect(plan.remove.map((r) => r.id)).toEqual(['clean']);
  });
});
