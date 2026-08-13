/**
 * A job card read "Quote" / "Quote sent" on jobs whose document was
 * already an invoice.
 *
 * The wording was picked off the JOB stage, and the job can sit at
 * `quoted` indefinitely after conversion: convertDocumentToInvoice
 * deliberately leaves the new invoice at stage `draft` so the tradie still
 * has to press Send, and deriveJobStageBump has no rule for `draft`, so
 * nothing drags the job forward. The tradie then goes hunting for a
 * "Convert to Invoice" row that is correctly hidden, because the document
 * was converted all along.
 */
import { describe, it, expect } from 'vitest';

import { getJobSubStatus } from './jobTimeline';

function job(over: Record<string, any> = {}): any {
  return { id: 'j1', stage: 'quoted', ...over };
}

function invoice(over: Record<string, any> = {}): any {
  return { id: 'inv1', type: 'invoice', stage: 'draft', ...over };
}

function quote(over: Record<string, any> = {}): any {
  return { id: 'q1', type: 'quote', stage: 'quote_sent', ...over };
}

describe('getJobSubStatus — wording defers to an invoice document', () => {
  it('REGRESSION: a quoted job holding a converted invoice no longer reads "Quote"', () => {
    const status = getJobSubStatus(job({ stage: 'quoted' }), invoice({ stage: 'draft' }));
    expect(status.label).toBe('Invoice');
    expect(status.label).not.toMatch(/quote/i);
  });

  it('reads "Invoice Sent" once the invoice has gone out', () => {
    expect(getJobSubStatus(job({ stage: 'quoted' }), invoice({ stage: 'invoice_sent' })).label).toBe(
      'Invoice Sent',
    );
  });

  it('reads the money state on a part-paid invoice', () => {
    expect(
      getJobSubStatus(job({ stage: 'quoted' }), invoice({ stage: 'partially_paid' })).label,
    ).toBe('Part Paid');
  });

  it('reads "Paid" on a settled invoice even while the job lags behind', () => {
    expect(getJobSubStatus(job({ stage: 'quoted' }), invoice({ stage: 'paid' })).label).toBe('Paid');
  });

  it('also corrects an inquiry-stage job carrying an invoice', () => {
    expect(getJobSubStatus(job({ stage: 'inquiry' }), invoice()).label).toBe('Invoice');
  });

  it('keeps the slot keyed to the job stage so the rail geometry is unchanged', () => {
    expect(getJobSubStatus(job({ stage: 'quoted' }), invoice()).slot).toBe('quote');
  });

  it('ignores a cancelled invoice and keeps the quote wording', () => {
    expect(
      getJobSubStatus(job({ stage: 'quoted' }), invoice({ stage: 'cancelled' })).label,
    ).toBe('Quote');
  });
});

describe('getJobSubStatus — quotes are untouched', () => {
  it('still reads "Quote Sent" for a sent quote', () => {
    expect(getJobSubStatus(job({ stage: 'quoted' }), quote({ stage: 'quote_sent' })).label).toBe(
      'Quote Sent',
    );
  });

  it('still reads "Quote" for an unsent quote', () => {
    expect(getJobSubStatus(job({ stage: 'quoted' }), quote({ stage: 'draft' })).label).toBe('Quote');
  });

  it('still reads "Draft" for an inquiry with nothing attached', () => {
    expect(getJobSubStatus(job({ stage: 'inquiry' }), null).label).toBe('Draft');
  });

  // Job-stage facts aren't lies about the document, so they must survive —
  // losing the scheduled date pill would be a real regression.
  it('leaves later job stages alone, including the scheduled date pill', () => {
    expect(getJobSubStatus(job({ stage: 'completed' }), invoice()).label).toBe('Completed');
    expect(getJobSubStatus(job({ stage: 'in_progress' }), invoice({ stage: 'invoice_sent' })).label)
      .toBe('Invoice Sent');
    const scheduled = getJobSubStatus(
      job({ stage: 'scheduled', scheduledStartDate: Date.UTC(2026, 5, 20, 9) }),
      invoice(),
    );
    expect(scheduled.slot).toBe('scheduled');
    expect(scheduled.label).not.toBe('Invoice');
  });
});
