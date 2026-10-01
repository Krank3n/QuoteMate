import { describe, it, expect } from 'vitest';
import { buildTimesheetPdfHtml, timesheetDayLabel, TIMESHEET_EMPTY_LINE } from './timesheetHtml';
import { buildTimesheet } from '../time/buildTimesheet';

const business = { businessName: 'Rivo Plumbing' } as any;
const options = { periodLabel: '1 September 2026 – 30 September 2026', generatedLabel: '30 September 2026' };
const range = { fromKey: '2026-09-01', toKey: '2026-09-30' };
const jobs = [
  { id: 'deck', name: 'Back deck', customerName: 'Gigar' },
  { id: 'fence', name: 'Side fence <b>', customerName: 'Karl' },
];

describe('the timesheet PDF', () => {
  it('prints the business, the period, the entries and the total', () => {
    const html = buildTimesheetPdfHtml(
      buildTimesheet([{ jobId: 'deck', date: '2026-09-02', hours: 7.5, billable: true, note: 'rough-in', createdAt: 1 }], jobs, range),
      business,
      options,
    );
    expect(html).toContain('TIMESHEET');
    expect(html).toContain('Rivo Plumbing');
    expect(html).toContain('1 September 2026 – 30 September 2026');
    expect(html).toContain('Back deck');
    expect(html).toContain('rough-in');
    expect(html).toContain('7.5 h over 1 day');
    expect(html).not.toContain('QuoteMate');
  });

  it('escapes what the tradie typed', () => {
    const html = buildTimesheetPdfHtml(
      buildTimesheet([{ jobId: 'fence', date: '2026-09-02', hours: 1, billable: true, createdAt: 1 }], jobs, range),
      business,
      options,
    );
    expect(html).toContain('Side fence &lt;b&gt;');
  });

  it('adds a by-job table only when there is more than one job, and a Charged column only when something was not charged', () => {
    const one = buildTimesheetPdfHtml(
      buildTimesheet([{ jobId: 'deck', date: '2026-09-02', hours: 2, billable: true, createdAt: 1 }], jobs, range),
      business,
      options,
    );
    expect(one).not.toContain('By job');
    expect(one).not.toContain('<th>Charged</th>');
    const two = buildTimesheetPdfHtml(
      buildTimesheet(
        [
          { jobId: 'deck', date: '2026-09-02', hours: 2, billable: true, createdAt: 1 },
          { jobId: 'fence', date: '2026-09-03', hours: 1, billable: false, createdAt: 2 },
        ],
        jobs,
        range,
      ),
      business,
      options,
    );
    expect(two).toContain('By job');
    expect(two).toContain('<th>Charged</th>');
  });

  it('says so when the period is empty', () => {
    expect(buildTimesheetPdfHtml(buildTimesheet([], jobs, range), business, options)).toContain(TIMESHEET_EMPTY_LINE);
  });

  it('labels days without drifting across time zones', () => {
    expect(timesheetDayLabel('2026-09-30')).toMatch(/^Wed,? 30 Sep(t)? 2026$/);
  });
});
