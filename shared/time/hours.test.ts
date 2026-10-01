import { describe, it, expect } from 'vitest';
import {
  dateKeyDaysAgo,
  formatHours,
  hoursBetween,
  hoursByJob,
  isDateKey,
  isValidEntryHours,
  parseHoursInput,
  sortEntriesNewestFirst,
  sumBillableHours,
  sumHours,
  addDaysKey,
  weekKeys,
  weekStartKey,
} from './hours';

describe('summing logged hours', () => {
  it('adds every entry and rounds to the hundredth', () => {
    expect(sumHours([{ hours: 7.5 }, { hours: 0.25 }, { hours: 1.1 }])).toBe(8.85);
  });

  it('ignores junk hours rather than turning the total into NaN', () => {
    expect(sumHours([{ hours: 4 }, { hours: NaN }, { hours: -3 }, { hours: 0 }])).toBe(4);
  });

  it('leaves non-billable time out of what gets invoiced', () => {
    const entries = [
      { hours: 6, billable: true },
      { hours: 2, billable: false },
      { hours: 1.5, billable: true },
    ];
    expect(sumHours(entries)).toBe(9.5);
    expect(sumBillableHours(entries)).toBe(7.5);
  });

  it('a deleted entry simply stops counting — the sum is over what is left', () => {
    const entries = [{ hours: 3, billable: true }, { hours: 5, billable: true }];
    expect(sumBillableHours(entries.slice(1))).toBe(5);
  });

  it('groups hours per job, optionally billable only', () => {
    const entries = [
      { jobId: 'a', hours: 2, billable: true },
      { jobId: 'b', hours: 1, billable: true },
      { jobId: 'a', hours: 3, billable: false },
    ];
    expect(Object.fromEntries(hoursByJob(entries))).toEqual({ a: 5, b: 1 });
    expect(Object.fromEntries(hoursByJob(entries, { billableOnly: true }))).toEqual({ a: 2, b: 1 });
  });
});

describe('reading what the tradie typed', () => {
  it('takes decimals, comma decimals and hours:minutes', () => {
    expect(parseHoursInput('7.5')).toBe(7.5);
    expect(parseHoursInput('7,5')).toBe(7.5);
    expect(parseHoursInput('7:30')).toBe(7.5);
    expect(parseHoursInput('0:20')).toBe(0.33);
    expect(parseHoursInput(' 8 ')).toBe(8);
    expect(parseHoursInput('.5')).toBe(0.5);
  });

  it('refuses blank, zero, negative, over-a-day and non-numbers', () => {
    for (const bad of ['', '0', '-2', '25', '24:30', 'seven', '7h', '1e3']) {
      expect(parseHoursInput(bad), bad).toBeNull();
    }
  });

  it('accepts exactly 24 hours and nothing past it', () => {
    expect(isValidEntryHours(24)).toBe(true);
    expect(isValidEntryHours(24.01)).toBe(false);
    expect(isValidEntryHours(0)).toBe(false);
    expect(isValidEntryHours('8')).toBe(false);
  });

  it('works out hours between a start and a finish, less the break', () => {
    expect(hoursBetween('07:00', '15:30')).toBe(8.5);
    expect(hoursBetween('7:00', '15:30', 30)).toBe(8);
    expect(hoursBetween('15:00', '07:00')).toBeNull();
    expect(hoursBetween('7am', '3pm')).toBeNull();
  });
});

describe('days', () => {
  const now = new Date(2026, 8, 30, 21, 45); // 30 Sep 2026, evening

  it('counts back whole local days, across a month end', () => {
    expect(dateKeyDaysAgo(0, now)).toBe('2026-09-30');
    expect(dateKeyDaysAgo(1, now)).toBe('2026-09-29');
    expect(dateKeyDaysAgo(30, now)).toBe('2026-08-31');
  });

  it('only accepts a real calendar day', () => {
    expect(isDateKey('2026-09-30')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('30/09/2026')).toBe(false);
    expect(isDateKey(undefined)).toBe(false);
  });

  it('sorts newest day first, then most recently logged', () => {
    const sorted = sortEntriesNewestFirst([
      { id: 'old', date: '2026-09-01', createdAt: 5 },
      { id: 'new-early', date: '2026-09-30', createdAt: 1 },
      { id: 'new-late', date: '2026-09-30', createdAt: 9 },
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['new-late', 'new-early', 'old']);
  });
});

it('formats hours without trailing zeros', () => {
  expect(formatHours(12.5)).toBe('12.5 h');
  expect(formatHours(8)).toBe('8 h');
  expect(formatHours(0.333)).toBe('0.33 h');
});

describe('weeks', () => {
  it('start on Monday, Sunday belonging to the week before it', () => {
    expect(weekStartKey('2026-10-01')).toBe('2026-09-28'); // Thursday
    expect(weekStartKey('2026-09-28')).toBe('2026-09-28'); // Monday
    expect(weekStartKey('2026-10-04')).toBe('2026-09-28'); // Sunday
  });

  it('count days across month and year ends', () => {
    expect(addDaysKey('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekKeys('2026-09-28')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });
});
