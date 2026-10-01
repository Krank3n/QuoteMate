import { describe, it, expect } from 'vitest';


import { jobTimeSummary } from './jobTimeSummary';

const hourly = { laborRate: 100, laborHours: 10, laborUnit: 'hours' } as any;
const lumpSum = { laborRate: 0, laborHours: 0, laborUnit: 'hours' } as any;

describe('the job screen time row', () => {
  it('invites logging when nothing is logged, naming the quoted hours', () => {
    expect(jobTimeSummary([], hourly)).toEqual({
      title: 'Log time',
      sub: '10 h quoted — track what it really takes',
      over: false,
      waiting: 0,
    });
  });

  it('has no quoted hours to mention on a set-price quote or with no quote', () => {
    expect(jobTimeSummary([], lumpSum).sub).toBe('Track the hours you put into this job');
    expect(jobTimeSummary([{ hours: 3, billable: true, date: '2026-09-01' }], null).title).toBe('3 h logged');
  });

  it('shows logged against quoted', () => {
    const s = jobTimeSummary(
      [{ hours: 4, billable: true, date: '2026-09-01' }, { hours: 2, billable: true, date: '2026-09-02' }],
      hourly,
    );
    expect(s).toEqual({ title: '6 h logged · 10 h quoted', sub: 'across 2 days', over: false, waiting: 0 });
  });

  it('flags billable time over the quote', () => {
    const s = jobTimeSummary(
      [{ hours: 8, billable: true, date: '2026-09-01' }, { hours: 4.5, billable: true, date: '2026-09-01' }],
      hourly,
    );
    expect(s.over).toBe(true);
    expect(s.sub).toBe('2.5 h over the quote · on 1 day');
  });

  it("non-billable time doesn't push a job over", () => {
    const s = jobTimeSummary(
      [{ hours: 9, billable: true, date: '2026-09-01' }, { hours: 3, billable: false, date: '2026-09-02' }],
      hourly,
    );
    expect(s.title).toBe('12 h logged · 10 h quoted');
    expect(s.over).toBe(false);
  });

  it("names crew time waiting for approval but doesn't count it", () => {
    const s = jobTimeSummary(
      [
        { hours: 4, billable: true, date: '2026-09-01' },
        { hours: 8, billable: true, date: '2026-09-02', status: 'pending' as const },
      ],
      hourly,
    );
    expect(s.title).toBe('4 h logged · 10 h quoted');
    expect(s.sub).toBe('1 sent in, waiting for you · on 1 day');
    expect(s.waiting).toBe(1);
  });

  it('with only waiting time, invites approval rather than logging', () => {
    const s = jobTimeSummary([{ hours: 8, billable: true, date: '2026-09-02', status: 'pending' as const }], hourly);
    expect(s.title).toBe('Log time');
    expect(s.sub).toBe('1 sent in, waiting for you');
  });
});
