/**
 * The old filters bucketed by lifecycle stage: "Active" held 43 of 44 jobs
 * and "Completed" held none. Two rows of chips that separated nothing.
 *
 * These pin the replacement — buckets by what a job needs from you — and
 * the two properties that make the chip counts trustworthy: every job lands
 * somewhere, and it lands in exactly one place.
 */
import { describe, it, expect } from 'vitest';

import {
  bucketForJob,
  groupDocsByJob,
  isJobFilterKey,
  matchesJobFilter,
  JOB_FILTERS,
} from './jobBuckets';

function job(over: Record<string, any> = {}): any {
  return { id: 'job1', stage: 'inquiry', name: 'A job', customerName: 'Someone', ...over };
}

function invoice(over: Record<string, any> = {}): any {
  return { id: 'inv1', type: 'invoice', stage: 'invoice_sent', total: 1000, paidTotal: 0, ...over };
}

function quote(over: Record<string, any> = {}): any {
  return { id: 'q1', type: 'quote', stage: 'draft', total: 1000, paidTotal: 0, ...over };
}

describe('bucketForJob', () => {
  it('puts an unsent draft in "to send" — the pile that was drowning "Active"', () => {
    expect(bucketForJob(job({ stage: 'inquiry' }), [quote()])).toBe('to_send');
  });

  it('puts a job with no documents at all in "to send"', () => {
    expect(bucketForJob(job(), [])).toBe('to_send');
  });

  it('puts a sent quote in "waiting" — the ball is with the customer', () => {
    expect(
      bucketForJob(job({ stage: 'quoted' }), [quote({ stage: 'quote_sent' })]),
    ).toBe('waiting');
  });

  it('puts an invoice with a balance in "owed"', () => {
    expect(
      bucketForJob(job({ stage: 'in_progress' }), [invoice({ total: 1000, paidTotal: 0 })]),
    ).toBe('owed');
  });

  it('counts a part-paid invoice as owed', () => {
    expect(
      bucketForJob(job({ stage: 'completed' }), [
        invoice({ stage: 'partially_paid', total: 1000, paidTotal: 400 }),
      ]),
    ).toBe('owed');
  });

  it('does not call a settled invoice owed', () => {
    expect(
      bucketForJob(job({ stage: 'completed' }), [
        invoice({ stage: 'paid', total: 1000, paidTotal: 1000 }),
      ]),
    ).not.toBe('owed');
  });

  // Money outranks the diary: a booked job that's been invoiced and not
  // paid is money owed, not a calendar entry.
  it('ranks money above the calendar when a booked job is also unpaid', () => {
    expect(
      bucketForJob(job({ stage: 'scheduled', scheduledStartDate: 123 }), [invoice()]),
    ).toBe('owed');
  });

  it('puts booked work with nothing owing in "scheduled"', () => {
    expect(
      bucketForJob(job({ stage: 'scheduled', scheduledStartDate: 123 }), [
        quote({ stage: 'quote_accepted' }),
      ]),
    ).toBe('scheduled');
  });

  it('treats in-progress work as scheduled', () => {
    expect(bucketForJob(job({ stage: 'in_progress' }), [])).toBe('scheduled');
  });

  // A finished job with nothing invoiced still needs something sent — it
  // must not vanish into "done".
  it('puts completed-but-not-invoiced work back in "to send"', () => {
    expect(bucketForJob(job({ stage: 'completed' }), [])).toBe('to_send');
  });

  it('puts paid, closed, cancelled and archived jobs in "done"', () => {
    expect(bucketForJob(job({ stage: 'paid' }), [])).toBe('done');
    expect(bucketForJob(job({ stage: 'closed' }), [])).toBe('done');
    expect(bucketForJob(job({ stage: 'cancelled' }), [])).toBe('done');
    expect(bucketForJob(job({ stage: 'quoted', archivedAt: 123 }), [])).toBe('done');
  });

  // An archived job reappearing in a working pile because of a stale doc
  // is exactly what the old 'archived' filter got wrong.
  it('keeps an archived job in "done" even with an invoice owing', () => {
    expect(bucketForJob(job({ archivedAt: 123 }), [invoice()])).toBe('done');
  });

  it('ignores cancelled documents when deciding', () => {
    expect(
      bucketForJob(job({ stage: 'quoted' }), [
        invoice({ stage: 'cancelled', total: 5000, paidTotal: 0 }),
      ]),
    ).not.toBe('owed');
  });

  it('treats a within-half-a-cent balance as settled', () => {
    expect(
      bucketForJob(job({ stage: 'completed' }), [invoice({ total: 1000, paidTotal: 999.999 })]),
    ).not.toBe('owed');
  });
});

describe('bucket integrity — what makes the chip counts trustworthy', () => {
  const population: Array<[any, any[]]> = [
    [job({ id: 'a', stage: 'inquiry' }), [quote()]],
    [job({ id: 'b', stage: 'quoted' }), [quote({ stage: 'quote_sent' })]],
    [job({ id: 'c', stage: 'in_progress' }), [invoice()]],
    [job({ id: 'd', stage: 'scheduled', scheduledStartDate: 1 }), []],
    [job({ id: 'e', stage: 'paid' }), []],
    [job({ id: 'f', stage: 'cancelled' }), []],
    [job({ id: 'g', stage: 'completed' }), []],
  ];

  it('lands every job in exactly one bucket', () => {
    for (const [j, docs] of population) {
      const hits = JOB_FILTERS.filter(
        (f) => f.key !== 'all' && matchesJobFilter(j, docs, f.key),
      );
      expect(hits).toHaveLength(1);
    }
  });

  it('counts across the buckets sum to the population', () => {
    const total = JOB_FILTERS.filter((f) => f.key !== 'all').reduce(
      (sum, f) => sum + population.filter(([j, d]) => matchesJobFilter(j, d, f.key)).length,
      0,
    );
    expect(total).toBe(population.length);
  });

  it('"all" matches everything', () => {
    for (const [j, docs] of population) {
      expect(matchesJobFilter(j, docs, 'all')).toBe(true);
    }
  });
});

describe('groupDocsByJob', () => {
  it('indexes each job’s documents under its id', () => {
    const docs = [
      invoice({ id: 'a', jobId: 'j1' }),
      invoice({ id: 'b', jobId: 'j1' }),
      quote({ id: 'c', jobId: 'j2' }),
    ];
    const byJob = groupDocsByJob(docs);
    expect(byJob.get('j1')!.map((d: any) => d.id)).toEqual(['a', 'b']);
    expect(byJob.get('j2')!.map((d: any) => d.id)).toEqual(['c']);
  });

  it('drops documents with no jobId rather than grouping them under undefined', () => {
    const byJob = groupDocsByJob([invoice({ id: 'orphan' })]);
    expect(byJob.size).toBe(0);
  });

  it('returns an empty map for an empty list', () => {
    expect(groupDocsByJob([]).size).toBe(0);
  });
});

describe('isJobFilterKey', () => {
  it('accepts every shipped chip', () => {
    for (const f of JOB_FILTERS) expect(isJobFilterKey(f.key)).toBe(true);
  });

  it('rejects a chip from an older build — a persisted "archived" would strand the user on an empty list', () => {
    expect(isJobFilterKey('archived')).toBe(false);
    expect(isJobFilterKey('active')).toBe(false);
    expect(isJobFilterKey(undefined)).toBe(false);
  });
});
