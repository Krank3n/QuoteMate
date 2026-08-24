/**
 * Backdating feature — pure-logic tests mirroring the exact field math in
 * JobPreviewScreen's handleDocumentDateChange / effectiveDocDateMs, plus the
 * PDF-side precedence. Full-screen render tests aren't practical here (the
 * screen pulls in ~40 native modules); these guard the parts a regression
 * would actually break.
 */
import { describe, it, expect } from 'vitest';
import { calculateDueDate } from '../../utils/invoiceCalculator';
import {
  quoteRecordToDocumentRecord,
  documentRecordToQuoteRecord,
  invoiceRecordToDocumentRecord,
  documentRecordToInvoiceRecord,
} from '../../../shared/document/adapter';

// Mirror of the screen's effectiveDocDateMs derivation.
function effectiveDocDateMs(
  isInvoiceMode: boolean,
  quote: any,
  invoice: any,
) {
  const issueDate = invoice?.issueDate || new Date();
  return isInvoiceMode
    ? new Date(invoice?.documentDate ?? issueDate).getTime()
    : quote?.documentDate ??
        new Date(quote?.updatedAt ?? Date.now()).getTime();
}

// Mirror of the invoice branch of handleDocumentDateChange.
function invoiceDatePatch(invoice: any, ms: number | undefined) {
  const paymentTerms = invoice.paymentTerms ?? 'net_14';
  const days =
    paymentTerms === 'custom' ? invoice.customPaymentDays || 0 : undefined;
  const newIssueDate = ms ? new Date(ms) : new Date();
  return {
    issueDate: newIssueDate,
    documentDate: newIssueDate.getTime(),
    dueDate: calculateDueDate(newIssueDate, paymentTerms, days),
  };
}

describe('effectiveDocDateMs (header badge)', () => {
  it('quote without documentDate shows updatedAt', () => {
    const updatedAt = new Date('2026-08-24T10:00:00');
    const ms = effectiveDocDateMs(false, { updatedAt }, null);
    expect(ms).toBe(updatedAt.getTime());
  });

  it('quote with documentDate (backdate) wins over updatedAt', () => {
    const backdate = new Date('2026-06-28T00:00:00').getTime();
    const ms = effectiveDocDateMs(
      false,
      { updatedAt: new Date('2026-08-24'), documentDate: backdate },
      null,
    );
    expect(ms).toBe(backdate);
  });

  it('invoice shows issueDate when no documentDate', () => {
    const issueDate = new Date('2026-08-01T00:00:00');
    const ms = effectiveDocDateMs(true, null, { issueDate });
    expect(ms).toBe(issueDate.getTime());
  });
});

describe('invoice date patch', () => {
  it('moves issueDate, stamps documentDate, recomputes dueDate (net_14)', () => {
    const backdate = new Date('2026-06-28T00:00:00').getTime();
    const patch = invoiceDatePatch({ paymentTerms: 'net_14' }, backdate);
    expect(patch.issueDate.getTime()).toBe(backdate);
    expect(patch.documentDate).toBe(backdate);
    expect(patch.dueDate.getTime()).toBe(
      new Date('2026-07-12T00:00:00').getTime(),
    );
  });

  it('respects custom payment terms', () => {
    const backdate = new Date('2026-06-28T00:00:00').getTime();
    const patch = invoiceDatePatch(
      { paymentTerms: 'custom', customPaymentDays: 30 },
      backdate,
    );
    expect(patch.dueDate.getTime()).toBe(
      new Date('2026-07-28T00:00:00').getTime(),
    );
  });

  it('reset (undefined) restores today and stamps documentDate', () => {
    const patch = invoiceDatePatch({ paymentTerms: 'net_14' }, undefined);
    const now = Date.now();
    expect(Math.abs(patch.documentDate! - now)).toBeLessThan(5000);
    expect(patch.dueDate.getTime()).toBeGreaterThanOrEqual(now);
  });
});

describe('adapter round-trip preserves documentDate', () => {
  it('quote → document → quote', () => {
    const backdate = new Date('2026-06-28T00:00:00').getTime();
    const quote: any = {
      id: 'q1',
      quoteNumber: 'Q-001',
      createdAt: new Date('2026-08-24'),
      updatedAt: new Date('2026-08-24'),
      status: 'draft',
      documentDate: backdate,
      customerName: 'Test',
      job: { id: 'j1', name: 'Job', description: '' },
      materials: [],
      payments: [],
      paidTotal: 0,
      balanceDue: 0,
      total: 0,
    };
    const doc = quoteRecordToDocumentRecord(quote, 'q1');
    expect(doc.documentDate).toBe(backdate);
    // createdAt must be untouched — sync ordering depends on it.
    expect(doc.createdAt).toBe(new Date('2026-08-24').getTime());
    const back = documentRecordToQuoteRecord(doc);
    expect(back.documentDate).toBe(backdate);
  });

  it('invoice → document → invoice', () => {
    const backdate = new Date('2026-06-28T00:00:00').getTime();
    const invoice: any = {
      id: 'i1',
      invoiceNumber: 'INV-001',
      createdAt: new Date('2026-08-24'),
      updatedAt: new Date('2026-08-24'),
      issueDate: new Date(backdate),
      dueDate: new Date('2026-07-12'),
      status: 'sent',
      documentDate: backdate,
      customerName: 'Test',
      job: { id: 'j1', name: 'Job', description: '' },
      materials: [],
      payments: [],
      paidTotal: 0,
      balanceDue: 0,
      total: 0,
    };
    const doc = invoiceRecordToDocumentRecord(invoice, 'i1');
    expect(doc.documentDate).toBe(backdate);
    const back = documentRecordToInvoiceRecord(doc);
    expect(back.documentDate).toBe(backdate);
    expect((back.issueDate as Date).getTime()).toBe(backdate);
  });
});
