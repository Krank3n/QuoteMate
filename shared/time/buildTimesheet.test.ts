import { describe, it, expect } from 'vitest';
import { buildTimesheet, DELETED_JOB_NAME, timesheetSummaryLine, timesheetToCsv } from './buildTimesheet';

const e = (jobId: string, date: string, hours: number, over: Record<string, unknown> = {}) => ({
  jobId,
  date,
  hours,
  billable: true,
  createdAt: 1,
  ...over,
});

const jobs = [
  { id: 'deck', name: 'Back deck', customerName: 'Gigar' },
  { id: 'fence', name: 'Side fence', customerName: 'Karl' },
];

const range = { fromKey: '2026-09-01', toKey: '2026-09-30' };

describe('the timesheet for a period', () => {
  it('keeps entries inside the period, both ends inclusive, oldest first', () => {
    const t = buildTimesheet(
      [
        e('deck', '2026-09-30', 4),
        e('deck', '2026-08-31', 9),
        e('fence', '2026-09-01', 6),
        e('fence', '2026-10-01', 3),
      ],
      jobs,
      range,
    );
    expect(t.rows.map((r) => [r.date, r.jobName, r.hours])).toEqual([
      ['2026-09-01', 'Side fence', 6],
      ['2026-09-30', 'Back deck', 4],
    ]);
    expect(t.totalHours).toBe(10);
    expect(t.daysWorked).toBe(2);
  });

  it('subtotals by job, biggest first, with charged hours apart', () => {
    const t = buildTimesheet(
      [e('deck', '2026-09-02', 8), e('deck', '2026-09-03', 2, { billable: false }), e('fence', '2026-09-03', 3)],
      jobs,
      range,
    );
    expect(t.byJob).toEqual([
      { jobId: 'deck', jobName: 'Back deck', customerName: 'Gigar', hours: 10, billableHours: 8, entryCount: 2 },
      { jobId: 'fence', jobName: 'Side fence', customerName: 'Karl', hours: 3, billableHours: 3, entryCount: 1 },
    ]);
    expect(t.billableHours).toBe(11);
    expect(timesheetSummaryLine(t)).toBe('13 h over 2 days · 11 h charged');
  });

  it("keeps time on a job that's since been deleted, under a plain label", () => {
    const t = buildTimesheet([e('gone', '2026-09-05', 2)], jobs, range);
    expect(t.rows[0].jobName).toBe(DELETED_JOB_NAME);
    expect(t.totalHours).toBe(2);
  });

  it('says so when nothing was logged', () => {
    expect(timesheetSummaryLine(buildTimesheet([], jobs, range))).toBe('No time logged in this period');
  });
});

describe('hours per person', () => {
  it("totals each person, names crew from the list, costs them at their rate, and leaves waiting time out", () => {
    const t = buildTimesheet(
      [
        e('deck', '2026-09-02', 8, { workerId: 'owner', workerName: 'Rivo Plumbing' }),
        e('deck', '2026-09-02', 6, { workerId: 'crew:c1', workerName: 'Jakey' }),
        e('fence', '2026-09-03', 2, { workerId: 'crew:c1' }),
        e('fence', '2026-09-03', 5, { workerId: 'crew:c1', status: 'pending' }),
      ],
      jobs,
      range,
      [{ id: 'c1', name: 'Jake', costRate: 40 }],
    );
    expect(t.byWorker).toEqual([
      { workerId: 'owner', workerName: 'Rivo Plumbing', hours: 8 },
      { workerId: 'crew:c1', workerName: 'Jake', hours: 8, cost: 320 },
    ]);
    expect(t.totalHours).toBe(16);
    expect(t.rows.find((r) => r.hours === 6)?.workerName).toBe('Jake');
  });
});

describe('the timesheet CSV', () => {
  it('is one row per entry, with a header, dates as YYYY-MM-DD and hours as numbers', () => {
    const csv = timesheetToCsv(
      buildTimesheet(
        [e('deck', '2026-09-02', 7.5, { note: 'rough-in, level 2', workerName: 'Rivo Plumbing' })],
        jobs,
        range,
      ),
    );
    expect(csv).toBe(
      'date,job,customer,hours,charged,note,worked by\r\n' +
        '2026-09-02,Back deck,Gigar,7.5,yes,"rough-in, level 2",Rivo Plumbing\r\n',
    );
  });

  it('keeps a note that starts like a formula as text in Excel', () => {
    const csv = timesheetToCsv(buildTimesheet([e('deck', '2026-09-02', 1, { note: '=SUM(A1)' })], jobs, range));
    expect(csv).toContain(`"'=SUM(A1)"`);
  });
});
