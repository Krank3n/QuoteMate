import { computeJobAggregates } from './aggregate';
import type { JobDocument } from './types';

const JOB = { id: 'job1' as const };

function doc(over: Partial<JobDocument> = {}): JobDocument {
  return {
    id: 'd?',
    jobId: 'job1',
    type: 'quote',
    stage: 'draft',
    total: 0,
    paidTotal: 0,
    balanceDue: 0,
    ...over,
  };
}

describe('computeJobAggregates (unified Document world)', () => {
  it('returns zeroes when nothing is attached', () => {
    expect(computeJobAggregates(JOB, [])).toEqual({
      totalQuoted: 0,
      totalInvoiced: 0,
      totalPaid: 0,
      balanceDue: 0,
      documentIds: [],
    });
  });

  it('ignores docs with a different jobId', () => {
    const docs = [
      doc({ id: 'd1', total: 500 }),
      doc({ id: 'dX', jobId: 'other', total: 9999 }),
    ];
    const r = computeJobAggregates(JOB, docs);
    expect(r.totalQuoted).toBe(500);
    expect(r.documentIds).toEqual(['d1']);
  });

  it('totalQuoted sums quote-typed docs, totalInvoiced sums invoice-typed', () => {
    const docs = [
      doc({ id: 'd1', type: 'quote', stage: 'quote_sent', total: 800 }),
      doc({ id: 'd2', type: 'quote', stage: 'quote_accepted', total: 400 }),
      doc({ id: 'd3', type: 'invoice', stage: 'invoice_sent', total: 1200 }),
    ];
    const r = computeJobAggregates(JOB, docs);
    expect(r.totalQuoted).toBe(1200);
    expect(r.totalInvoiced).toBe(1200);
  });

  it('sums paidTotal and balanceDue across all live docs', () => {
    const docs = [
      doc({
        id: 'd1',
        type: 'invoice',
        stage: 'partially_paid',
        total: 1000,
        paidTotal: 400,
        balanceDue: 600,
      }),
      doc({
        id: 'd2',
        type: 'invoice',
        stage: 'paid',
        total: 500,
        paidTotal: 500,
        balanceDue: 0,
      }),
    ];
    const r = computeJobAggregates(JOB, docs);
    expect(r.totalPaid).toBe(900);
    expect(r.balanceDue).toBe(600);
    expect(r.totalInvoiced).toBe(1500);
  });

  it('cancelled docs stop contributing to money but stay in documentIds', () => {
    const docs = [
      doc({ id: 'd1', type: 'quote', stage: 'quote_sent', total: 800 }),
      doc({ id: 'd2', stage: 'cancelled', total: 1000, paidTotal: 50 }),
    ];
    const r = computeJobAggregates(JOB, docs);
    expect(r.totalQuoted).toBe(800);
    expect(r.totalPaid).toBe(0);
    expect(r.documentIds).toEqual(['d1', 'd2']);
  });

  it('documentIds is de-duped and sorted', () => {
    const docs = [
      doc({ id: 'b' }),
      doc({ id: 'a' }),
      doc({ id: 'a' }),
      doc({ id: 'c' }),
    ];
    expect(computeJobAggregates(JOB, docs).documentIds).toEqual(['a', 'b', 'c']);
  });

  it('coerces non-numeric monetary fields to zero', () => {
    const docs = [
      doc({
        id: 'd1',
        type: 'invoice',
        stage: 'invoice_sent',
        total: NaN as unknown as number,
        paidTotal: undefined as unknown as number,
        balanceDue: undefined as unknown as number,
      }),
    ];
    const r = computeJobAggregates(JOB, docs);
    expect(r.totalInvoiced).toBe(0);
    expect(r.totalPaid).toBe(0);
    expect(r.balanceDue).toBe(0);
  });
});
