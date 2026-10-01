import { describe, it, expect } from 'vitest';
import { buildTimesheetWeek } from './timesheetWeek';
import type { TimeEntry } from '../../shared/time/types';

const e = (id: string, workerId: string, date: string, hours: number, over: Partial<TimeEntry> = {}): TimeEntry => ({
  id, userId: 'u', jobId: 'j', date, hours, workerId, billable: true, source: 'manual', createdAt: 1, updatedAt: 1, ...over,
});

const crew = [{ id: 'jake', name: 'Jake', createdAt: 1 }, { id: 'amy', name: 'Amy', createdAt: 1 }];

describe('the Timesheets week', () => {
  const entries = [
    e('1', 'u', '2026-09-29', 8),
    e('2', 'crew:jake', '2026-10-01', 6, { status: 'pending' }),
    e('3', 'crew:jake', '2026-09-30', 7.5),
    e('4', 'crew:amy', '2026-09-28', 4),
  ];

  it('groups by person — you first, then crew by name — oldest day first', () => {
    const w = buildTimesheetWeek(entries, crew);
    expect(w.people.map((p) => p.name)).toEqual(['You', 'Amy', 'Jake']);
    expect(w.people[2].entries.map((x) => x.id)).toEqual(['3', '2']);
  });

  it("counts approved hours only, and lists what's waiting", () => {
    const w = buildTimesheetWeek(entries, crew);
    const jake = w.people.find((p) => p.key === 'jake')!;
    expect(jake).toMatchObject({ total: 7.5, waiting: 1 });
    expect(w.waiting.map((x) => x.id)).toEqual(['2']);
    expect(w.total).toBe(19.5);
  });

  it('filters to one person', () => {
    expect(buildTimesheetWeek(entries, crew, 'jake').people.map((p) => p.name)).toEqual(['Jake']);
    expect(buildTimesheetWeek(entries, crew, 'me').total).toBe(8);
  });

  it("keeps someone taken off the crew under the name they worked as", () => {
    const w = buildTimesheetWeek([e('9', 'crew:gone', '2026-09-29', 3, { workerName: 'Shane' })], crew);
    expect(w.people[0].name).toBe('Shane');
  });
});
