import { computeJobAggregates, representativeQuote } from './aggregate';
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

  it('totalQuoted takes the accepted quote, not the sum; totalInvoiced still sums', () => {
    // Two quotes on a job are competing OPTIONS, never parts of the work, so
    // adding them states a price nobody was offered. This used to read 1200
    // (800 + 400) for a job whose customer had agreed to 400.
    const docs = [
      doc({ id: 'd1', type: 'quote', stage: 'quote_sent', total: 800 }),
      doc({ id: 'd2', type: 'quote', stage: 'quote_accepted', total: 400 }),
      doc({ id: 'd3', type: 'invoice', stage: 'invoice_sent', total: 1200 }),
    ];
    const r = computeJobAggregates(JOB, docs);
    expect(r.totalQuoted).toBe(400);
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

describe('a job carrying competing quote options', () => {
  it('quotes ONE option, never the sum', () => {
    // The bug this exists to stop: two alternatives priced at $6,675 and
    // $6,116 showing the job as worth $12,791.
    const docs = [
      doc({ id: 'opt1', stage: 'quote_sent', total: 6675.02, updatedAt: 20 }),
      doc({ id: 'opt2', stage: 'draft', total: 6116, updatedAt: 10 }),
    ];

    expect(computeJobAggregates(JOB, docs).totalQuoted).toBe(6675.02);
  });

  it('lets an accepted option win outright, however stale', () => {
    const docs = [
      doc({ id: 'opt1', stage: 'quote_sent', total: 9999, updatedAt: 99 }),
      doc({ id: 'opt2', stage: 'quote_accepted', total: 6116, updatedAt: 1 }),
    ];

    // Once the customer has chosen, that IS the price.
    expect(computeJobAggregates(JOB, docs).totalQuoted).toBe(6116);
  });

  it('otherwise leads with the most recently touched, matching the job screen', () => {
    const docs = [
      doc({ id: 'old', stage: 'quote_sent', total: 100, updatedAt: 1 }),
      doc({ id: 'new', stage: 'draft', total: 200, updatedAt: 2 }),
    ];

    expect(computeJobAggregates(JOB, docs).totalQuoted).toBe(200);
  });

  it('falls back to createdAt, then id, so the answer never depends on read order', () => {
    const forward = [
      doc({ id: 'a', stage: 'draft', total: 100, createdAt: 5 }),
      doc({ id: 'b', stage: 'draft', total: 200, createdAt: 9 }),
    ];
    const reversed = [...forward].reverse();

    expect(computeJobAggregates(JOB, forward).totalQuoted).toBe(200);
    expect(computeJobAggregates(JOB, reversed).totalQuoted).toBe(200);

    // Fully tied: id decides, and decides the same way both ways round.
    const tiedA = [doc({ id: 'a', total: 1 }), doc({ id: 'b', total: 2 })];
    const tiedB = [...tiedA].reverse();
    expect(computeJobAggregates(JOB, tiedA).totalQuoted)
      .toBe(computeJobAggregates(JOB, tiedB).totalQuoted);
  });

  it('owes the balance of one option, not both', () => {
    const docs = [
      doc({ id: 'opt1', stage: 'quote_sent', total: 500, balanceDue: 500, updatedAt: 2 }),
      doc({ id: 'opt2', stage: 'draft', total: 700, balanceDue: 700, updatedAt: 1 }),
    ];

    expect(computeJobAggregates(JOB, docs).balanceDue).toBe(500);
  });

  it('adds the invoice balance to the representative quote’s, not to every option', () => {
    const docs = [
      doc({ id: 'opt1', stage: 'quote_sent', total: 500, balanceDue: 0, updatedAt: 2 }),
      doc({ id: 'opt2', stage: 'draft', total: 700, balanceDue: 700, updatedAt: 1 }),
      doc({ id: 'inv', type: 'invoice', stage: 'invoice_sent', total: 500, balanceDue: 500 }),
    ];

    expect(computeJobAggregates(JOB, docs).balanceDue).toBe(500);
  });

  it('still counts money taken against a losing option', () => {
    // An option with money on it is never superseded (see
    // quotesSupersededByAccepting) — and hiding a real payment because its
    // quote did not win would make the job look unpaid.
    const docs = [
      doc({ id: 'winner', stage: 'quote_accepted', total: 500, paidTotal: 0, updatedAt: 2 }),
      doc({ id: 'loser', stage: 'quote_sent', total: 700, paidTotal: 200, updatedAt: 1 }),
    ];

    expect(computeJobAggregates(JOB, docs).totalPaid).toBe(200);
  });

  it('ignores a superseded option entirely', () => {
    const docs = [
      doc({ id: 'winner', stage: 'quote_accepted', total: 500, updatedAt: 1 }),
      doc({ id: 'superseded', stage: 'cancelled', total: 700, updatedAt: 9 }),
    ];
    const r = computeJobAggregates(JOB, docs);

    expect(r.totalQuoted).toBe(500);
    // …but it stays on the job's document list, so the history is still there.
    expect(r.documentIds).toEqual(['superseded', 'winner']);
  });

  it('leaves the ordinary single-quote job exactly as it was', () => {
    const docs = [doc({ id: 'only', stage: 'quote_sent', total: 972.4, balanceDue: 972.4 })];
    const r = computeJobAggregates(JOB, docs);

    expect(r.totalQuoted).toBe(972.4);
    expect(r.balanceDue).toBe(972.4);
  });
});

describe('representativeQuote', () => {
  it('is undefined when a job has no quotes', () => {
    expect(representativeQuote([])).toBeUndefined();
  });

  it('is the only quote when there is one', () => {
    const only = doc({ id: 'only', total: 10 });
    expect(representativeQuote([only])).toBe(only);
  });

  it('prefers an accepted quote over a newer sent one', () => {
    const accepted = doc({ id: 'a', stage: 'quote_accepted', updatedAt: 1 });
    const sent = doc({ id: 'b', stage: 'quote_sent', updatedAt: 99 });

    expect(representativeQuote([sent, accepted])).toBe(accepted);
  });

  it('picks the newest of several accepted quotes', () => {
    const older = doc({ id: 'a', stage: 'quote_accepted', updatedAt: 1 });
    const newer = doc({ id: 'b', stage: 'quote_accepted', updatedAt: 2 });

    expect(representativeQuote([older, newer])).toBe(newer);
  });

  it('does not mutate its input', () => {
    const docs = [doc({ id: 'a', updatedAt: 1 }), doc({ id: 'b', updatedAt: 2 })];
    const before = docs.map((d) => d.id);

    representativeQuote(docs);

    expect(docs.map((d) => d.id)).toEqual(before);
  });
});
