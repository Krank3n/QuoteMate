/**
 * Two bug histories converge here.
 *
 * One: the list's order used to disagree with the date printed on each card,
 * so the ordering read as no ordering at all. Adding sort options threatens to
 * bring that back, so every sort key must have something on the card that
 * explains it — the last block asserts that mechanically.
 *
 * Two: the card summed the STORED `balanceDue` while jobBuckets and
 * paidTransition both recomputed `total - paidTotal` because the stored field
 * goes stale. The green price and the chip counts were therefore derived by
 * different rules. jobHeadlineValue is the single rule; the regression case
 * below pins it.
 */
import { describe, it, expect } from 'vitest';

import {
  JOB_SORTS,
  buildJobSortMetrics,
  isJobSortKey,
  jobHeadlineValue,
  jobSortLabel,
  sortJobsBy,
  type JobSortKey,
} from './jobSort';
import { sortJobsForList } from './jobTimeline';

const DAY = 24 * 60 * 60 * 1000;
const T = 1_700_000_000_000;

function job(over: Record<string, any> = {}): any {
  return {
    id: 'job1',
    stage: 'inquiry',
    name: 'A job',
    customerName: 'Someone',
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

function invoice(over: Record<string, any> = {}): any {
  return {
    id: 'inv1',
    type: 'invoice',
    stage: 'invoice_sent',
    total: 1000,
    paidTotal: 0,
    ...over,
  };
}

function quote(over: Record<string, any> = {}): any {
  return { id: 'q1', type: 'quote', stage: 'draft', total: 1000, paidTotal: 0, ...over };
}

function docsMap(entries: Record<string, any[]>): Map<string, any[]> {
  return new Map(Object.entries(entries));
}

/** Build metrics for a population and sort it, returning ids. */
function order(jobs: any[], key: JobSortKey, docs: Record<string, any[]> = {}, now = T): string[] {
  const metrics = buildJobSortMetrics(jobs, docsMap(docs), now);
  return sortJobsBy(jobs, key, metrics).map((j: any) => j.id);
}

describe('jobHeadlineValue — money comes from the documents, never the Job', () => {
  it('REGRESSION: ignores a stale stored balanceDue and recomputes from total minus paidTotal', () => {
    // Stored balanceDue says 999; the real outstanding amount is 400.
    const money = jobHeadlineValue([invoice({ total: 1000, paidTotal: 600, balanceDue: 999 })]);
    expect(money).toEqual({ value: 400, kind: 'owing' });
  });

  it('counts a part-paid invoice at its remaining balance', () => {
    expect(jobHeadlineValue([invoice({ total: 1000, paidTotal: 250 })]).value).toBe(750);
  });

  it('excludes cancelled documents', () => {
    const money = jobHeadlineValue([
      invoice({ total: 1000, paidTotal: 0, stage: 'cancelled' }),
      quote({ total: 500 }),
    ]);
    expect(money).toEqual({ value: 500, kind: 'quoted' });
  });

  it('uses the quoted total when nothing has been invoiced', () => {
    expect(jobHeadlineValue([quote({ total: 2500 })])).toEqual({ value: 2500, kind: 'quoted' });
  });

  it('reports the paid total once the balance is settled', () => {
    expect(jobHeadlineValue([invoice({ total: 1000, paidTotal: 1000 })])).toEqual({
      value: 1000,
      kind: 'paid',
    });
  });

  it('treats a within-half-a-cent balance as settled', () => {
    expect(jobHeadlineValue([invoice({ total: 1000, paidTotal: 999.999 })]).kind).toBe('paid');
  });

  it("won't let an overpaid invoice cancel out another invoice's debt", () => {
    const money = jobHeadlineValue([
      invoice({ id: 'a', total: 1000, paidTotal: 1500 }),
      invoice({ id: 'b', total: 800, paidTotal: 0 }),
    ]);
    expect(money).toEqual({ value: 800, kind: 'owing' });
  });

  it('sums balances across two unpaid invoices', () => {
    const money = jobHeadlineValue([
      invoice({ id: 'a', total: 1000, paidTotal: 0 }),
      invoice({ id: 'b', total: 500, paidTotal: 0 }),
    ]);
    expect(money).toEqual({ value: 1500, kind: 'owing' });
  });

  it('reports nothing for a job with no documents', () => {
    expect(jobHeadlineValue([])).toEqual({ value: 0, kind: 'none' });
  });
});

describe('buildJobSortMetrics — overdue', () => {
  const now = T + 30 * DAY;

  it('measures overdue from the invoice due date', () => {
    const m = buildJobSortMetrics(
      [job()],
      docsMap({ job1: [invoice({ dueDate: T + 10 * DAY })] }),
      now,
    );
    expect(m.get('job1')!.overdueMs).toBe(20 * DAY);
  });

  it('falls back to sentAt when the invoice carries no due date', () => {
    const m = buildJobSortMetrics(
      [job()],
      docsMap({ job1: [invoice({ sentAt: T + 5 * DAY })] }),
      now,
    );
    expect(m.get('job1')!.overdueMs).toBe(25 * DAY);
  });

  it('reports nothing overdue for an invoice that is not yet due', () => {
    const m = buildJobSortMetrics(
      [job()],
      docsMap({ job1: [invoice({ dueDate: now + 5 * DAY })] }),
      now,
    );
    expect(m.get('job1')!.overdueMs).toBeNull();
  });

  it('reports nothing overdue for a settled invoice', () => {
    const m = buildJobSortMetrics(
      [job()],
      docsMap({ job1: [invoice({ total: 1000, paidTotal: 1000, dueDate: T })] }),
      now,
    );
    expect(m.get('job1')!.overdueMs).toBeNull();
  });

  it('reports nothing overdue for an invoice with no dates at all', () => {
    const m = buildJobSortMetrics([job()], docsMap({ job1: [invoice()] }), now);
    expect(m.get('job1')!.overdueMs).toBeNull();
  });

  it('takes the worst offender when a job has two overdue invoices', () => {
    const m = buildJobSortMetrics(
      [job()],
      docsMap({
        job1: [
          invoice({ id: 'a', dueDate: T + 20 * DAY, total: 100, paidTotal: 0 }),
          invoice({ id: 'b', dueDate: T, total: 700, paidTotal: 0 }),
        ],
      }),
      now,
    );
    expect(m.get('job1')!.overdueMs).toBe(30 * DAY);
    expect(m.get('job1')!.overdueAmount).toBe(700);
  });

  it('ignores cancelled invoices', () => {
    const m = buildJobSortMetrics(
      [job()],
      docsMap({ job1: [invoice({ stage: 'cancelled', dueDate: T })] }),
      now,
    );
    expect(m.get('job1')!.overdueMs).toBeNull();
  });

  it('ignores quotes, however old — a quote is not a debt', () => {
    const m = buildJobSortMetrics([job()], docsMap({ job1: [quote({ dueDate: T })] }), now);
    expect(m.get('job1')!.overdueMs).toBeNull();
  });
});

describe('sortJobsBy("recent")', () => {
  it('matches sortJobsForList exactly — the shipped default order is unchanged', () => {
    const population = [
      job({ id: 'a', stage: 'quoted', quotedAt: T + 3 * DAY }),
      job({ id: 'b', stage: 'paid', paidAt: T + DAY }),
      job({ id: 'c', stage: 'inquiry', updatedAt: T + 5 * DAY }),
      job({ id: 'd', stage: 'inquiry', updatedAt: 0, createdAt: 0 }),
    ];
    const metrics = buildJobSortMetrics(population, docsMap({}), T);
    expect(sortJobsBy(population, 'recent', metrics).map((j: any) => j.id)).toEqual(
      sortJobsForList(population).map((j: any) => j.id),
    );
  });
});

describe('sortJobsBy("oldest")', () => {
  it('puts the stalest job first', () => {
    const population = [
      job({ id: 'new', stage: 'quoted', quotedAt: T + 10 * DAY }),
      job({ id: 'old', stage: 'quoted', quotedAt: T }),
      job({ id: 'mid', stage: 'quoted', quotedAt: T + 5 * DAY }),
    ];
    expect(order(population, 'oldest')).toEqual(['old', 'mid', 'new']);
  });

  it('REGRESSION: keeps undated jobs at the bottom instead of promoting them to the top', () => {
    const population = [
      job({ id: 'undated', stage: 'inquiry', updatedAt: 0, createdAt: 0 }),
      job({ id: 'dated', stage: 'quoted', quotedAt: T }),
    ];
    expect(order(population, 'oldest')).toEqual(['dated', 'undated']);
  });

  it('breaks ties by recency then id, like every other sort', () => {
    const population = [
      job({ id: 'b', stage: 'quoted', quotedAt: T, updatedAt: T }),
      job({ id: 'a', stage: 'quoted', quotedAt: T, updatedAt: T }),
    ];
    expect(order(population, 'oldest')).toEqual(['a', 'b']);
  });
});

describe('sortJobsBy("value")', () => {
  it('puts the biggest number first', () => {
    const population = [job({ id: 'small' }), job({ id: 'big' })];
    const docs = { small: [quote({ total: 100 })], big: [quote({ total: 9000 })] };
    expect(order(population, 'value', docs)).toEqual(['big', 'small']);
  });

  it('sinks jobs with no money to the bottom', () => {
    const population = [job({ id: 'broke' }), job({ id: 'paid' })];
    const docs = { paid: [quote({ total: 500 })] };
    expect(order(population, 'value', docs)).toEqual(['paid', 'broke']);
  });

  it('orders equal-value jobs by recency', () => {
    const population = [
      job({ id: 'older', stage: 'quoted', quotedAt: T }),
      job({ id: 'newer', stage: 'quoted', quotedAt: T + DAY }),
    ];
    const docs = { older: [quote({ total: 500 })], newer: [quote({ total: 500 })] };
    expect(order(population, 'value', docs)).toEqual(['newer', 'older']);
  });

  it('ranks by the same number the card prints as its headline price', () => {
    // The card prints an outstanding balance for an invoiced job, so a job
    // owing $400 must rank BELOW one quoting $900 even though its invoice
    // total is larger.
    const population = [job({ id: 'owing' }), job({ id: 'quoted' })];
    const docs = {
      owing: [invoice({ total: 5000, paidTotal: 4600 })],
      quoted: [quote({ total: 900 })],
    };
    expect(order(population, 'value', docs)).toEqual(['quoted', 'owing']);
  });
});

describe('sortJobsBy("scheduled")', () => {
  it('puts the soonest start date first', () => {
    const population = [
      job({ id: 'later', scheduledStartDate: T + 10 * DAY }),
      job({ id: 'sooner', scheduledStartDate: T + 2 * DAY }),
    ];
    expect(order(population, 'scheduled')).toEqual(['sooner', 'later']);
  });

  it('keeps an overrun (past-dated) job above upcoming work rather than hiding it', () => {
    const population = [
      job({ id: 'upcoming', scheduledStartDate: T + 5 * DAY }),
      job({ id: 'overrun', scheduledStartDate: T - 5 * DAY }),
    ];
    expect(order(population, 'scheduled')).toEqual(['overrun', 'upcoming']);
  });

  it('sinks unscheduled jobs to the bottom', () => {
    const population = [
      job({ id: 'unscheduled' }),
      job({ id: 'booked', scheduledStartDate: T + DAY }),
    ];
    expect(order(population, 'scheduled')).toEqual(['booked', 'unscheduled']);
  });

  it('orders unscheduled jobs among themselves by recency', () => {
    const population = [
      job({ id: 'older', stage: 'quoted', quotedAt: T }),
      job({ id: 'newer', stage: 'quoted', quotedAt: T + DAY }),
    ];
    expect(order(population, 'scheduled')).toEqual(['newer', 'older']);
  });
});

describe('sortJobsBy("overdue")', () => {
  const now = T + 40 * DAY;

  it('puts the most-overdue invoice first', () => {
    const population = [job({ id: 'recent' }), job({ id: 'ancient' })];
    const docs = {
      recent: [invoice({ dueDate: T + 30 * DAY })],
      ancient: [invoice({ id: 'b', dueDate: T })],
    };
    expect(order(population, 'overdue', docs, now)).toEqual(['ancient', 'recent']);
  });

  it('sinks jobs with nothing overdue to the bottom', () => {
    const population = [job({ id: 'clean' }), job({ id: 'late' })];
    const docs = { late: [invoice({ dueDate: T })] };
    expect(order(population, 'overdue', docs, now)).toEqual(['late', 'clean']);
  });
});

describe('jobSortLabel — the card explains the order', () => {
  const now = T + 12 * DAY;

  it('prints the days overdue when sorting by most overdue', () => {
    const m = buildJobSortMetrics([job()], docsMap({ job1: [invoice({ dueDate: T })] }), now);
    expect(jobSortLabel('overdue', m.get('job1')!)).toMatchObject({
      text: 'Overdue 12 days',
      tone: 'urgent',
    });
  });

  it('says "day" rather than "days" at one day overdue', () => {
    const m = buildJobSortMetrics(
      [job()],
      docsMap({ job1: [invoice({ dueDate: now - DAY })] }),
      now,
    );
    expect(jobSortLabel('overdue', m.get('job1')!)!.text).toBe('Overdue 1 day');
  });

  it('prints nothing for a job that is not overdue, even under the overdue sort', () => {
    const m = buildJobSortMetrics([job()], docsMap({}), now);
    expect(jobSortLabel('overdue', m.get('job1')!)).toBeNull();
  });

  it('prints nothing for the sorts the card already explains', () => {
    const m = buildJobSortMetrics([job()], docsMap({}), now);
    const metrics = m.get('job1')!;
    for (const key of ['recent', 'oldest', 'value', 'scheduled'] as JobSortKey[]) {
      expect(jobSortLabel(key, metrics)).toBeNull();
    }
  });
});

describe('isJobSortKey', () => {
  it('accepts every shipped key', () => {
    for (const s of JOB_SORTS) expect(isJobSortKey(s.key)).toBe(true);
  });

  it('rejects a key from an older build rather than sorting by nothing', () => {
    expect(isJobSortKey('alphabetical')).toBe(false);
    expect(isJobSortKey(undefined)).toBe(false);
    expect(isJobSortKey(3)).toBe(false);
  });
});

describe('sort integrity — what makes the list trustworthy', () => {
  const POPULATION = [
    job({ id: 'a', stage: 'quoted', quotedAt: T + 3 * DAY, scheduledStartDate: T + DAY }),
    job({ id: 'b', stage: 'paid', paidAt: T + DAY }),
    job({ id: 'c', stage: 'inquiry', updatedAt: T + 5 * DAY }),
    job({ id: 'd', stage: 'inquiry', updatedAt: 0, createdAt: 0 }),
    job({ id: 'e', stage: 'in_progress', inProgressAt: T + 2 * DAY }),
  ];
  const DOCS = {
    a: [quote({ total: 4000 })],
    b: [invoice({ total: 900, paidTotal: 900 })],
    e: [invoice({ id: 'ei', total: 2000, paidTotal: 0, dueDate: T })],
  };
  const KEYS = JOB_SORTS.map((s) => s.key);
  const now = T + 20 * DAY;

  it('every sort returns exactly the jobs it was given — a sort never hides a row', () => {
    for (const key of KEYS) {
      const out = order(POPULATION, key, DOCS, now);
      expect(out.slice().sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    }
  });

  it('every sort is a total order — the same input sorts identically from either direction', () => {
    for (const key of KEYS) {
      const forward = order(POPULATION, key, DOCS, now);
      const backward = order([...POPULATION].reverse(), key, DOCS, now);
      expect(backward).toEqual(forward);
    }
  });

  it('every sort is stable across repeated calls', () => {
    for (const key of KEYS) {
      expect(order(POPULATION, key, DOCS, now)).toEqual(order(POPULATION, key, DOCS, now));
    }
  });

  it('no sort mutates the array it was given (the store owns that array)', () => {
    for (const key of KEYS) {
      const input = [...POPULATION];
      const before = input.map((j: any) => j.id);
      const metrics = buildJobSortMetrics(input, docsMap(DOCS), now);
      sortJobsBy(input, key, metrics);
      expect(input.map((j: any) => j.id)).toEqual(before);
    }
  });

  it('every sort key is offered in the menu, so none is unreachable', () => {
    const offered = new Set(JOB_SORTS.map((s) => s.key));
    for (const key of KEYS) expect(offered.has(key)).toBe(true);
  });

  it('every sort key has something on the card that explains the order', () => {
    // 'overdue' earns its own label; the rest are explained by text the card
    // already prints (stage date, headline price, scheduled line). If a sixth
    // key is added with neither, this fails and forces the decision.
    const explainedByExistingCardText: JobSortKey[] = ['recent', 'oldest', 'value', 'scheduled'];
    const metrics = buildJobSortMetrics(POPULATION, docsMap(DOCS), now);
    for (const key of KEYS) {
      const label = jobSortLabel(key, metrics.get('e')!);
      const explained = explainedByExistingCardText.includes(key) || label !== null;
      expect(explained, `sort "${key}" has nothing on the card to justify it`).toBe(true);
    }
  });

  it('sorts jobs with no metrics entry at all without throwing', () => {
    for (const key of KEYS) {
      expect(() => sortJobsBy(POPULATION, key, new Map())).not.toThrow();
      expect(sortJobsBy(POPULATION, key, new Map())).toHaveLength(POPULATION.length);
    }
  });
});
