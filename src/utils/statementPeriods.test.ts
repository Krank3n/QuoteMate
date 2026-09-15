/**
 * Statement periods. Every case pins a boundary in DEVICE LOCAL time — a UTC
 * computation would put "1 July" at 10am on 30 June in Sydney and quietly
 * move a day's invoices into the wrong financial year.
 *
 * `now` is fixed in each case so the suite reads the same in July as it does
 * in February.
 */
import { describe, it, expect } from 'vitest';

import { customPeriod, statementPeriod } from './statementPeriods';

/** Local midnight, the same way the helper builds its boundaries. */
const localDay = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

describe('statementPeriod — last financial year', () => {
  it('on 16 Sep 2026 runs 1 Jul 2025 to 1 Jul 2026, local', () => {
    const period = statementPeriod('lastFinancialYear', localDay(2026, 8, 16));
    expect(period.fromMs).toBe(localDay(2025, 6, 1));
    expect(period.toMs).toBe(localDay(2026, 6, 1));
    expect(period.label).toBe('1 Jul 2025 – 30 Jun 2026');
  });

  it('in February still means the FY that ended the previous June', () => {
    const period = statementPeriod('lastFinancialYear', localDay(2026, 1, 3));
    expect(period.fromMs).toBe(localDay(2024, 6, 1));
    expect(period.toMs).toBe(localDay(2025, 6, 1));
  });

  it('on 1 July the FY that ended the day before is the last completed one', () => {
    const period = statementPeriod('lastFinancialYear', localDay(2026, 6, 1) + 9 * 3600_000);
    expect(period.fromMs).toBe(localDay(2025, 6, 1));
    expect(period.toMs).toBe(localDay(2026, 6, 1));
  });
});

describe('statementPeriod — this financial year to date', () => {
  it('runs from 1 Jul to the start of tomorrow, so today is included', () => {
    const period = statementPeriod('thisFinancialYearToDate', localDay(2026, 8, 16) + 14 * 3600_000);
    expect(period.fromMs).toBe(localDay(2026, 6, 1));
    expect(period.toMs).toBe(localDay(2026, 8, 17));
    expect(period.label).toBe('1 Jul 2026 – 16 Sep 2026');
  });

  it('in a `now` before July starts at the previous July', () => {
    const period = statementPeriod('thisFinancialYearToDate', localDay(2026, 3, 9));
    expect(period.fromMs).toBe(localDay(2025, 6, 1));
    expect(period.toMs).toBe(localDay(2026, 3, 10));
  });

  it('on 2 July covers just the two days of the new year', () => {
    const period = statementPeriod('thisFinancialYearToDate', localDay(2026, 6, 2) + 6 * 3600_000);
    expect(period.fromMs).toBe(localDay(2026, 6, 1));
    expect(period.toMs).toBe(localDay(2026, 6, 3));
  });
});

describe('statementPeriod — last quarter', () => {
  it('is the most recent completed calendar quarter', () => {
    const period = statementPeriod('lastQuarter', localDay(2026, 8, 16));
    expect(period.fromMs).toBe(localDay(2026, 3, 1));
    expect(period.toMs).toBe(localDay(2026, 6, 1));
    expect(period.label).toBe('1 Apr 2026 – 30 Jun 2026');
  });

  it('crosses the year boundary in January', () => {
    const period = statementPeriod('lastQuarter', localDay(2026, 0, 14));
    expect(period.fromMs).toBe(localDay(2025, 9, 1));
    expect(period.toMs).toBe(localDay(2026, 0, 1));
    expect(period.label).toBe('1 Oct 2025 – 31 Dec 2025');
  });
});

describe('customPeriod', () => {
  it('includes everything recorded on the chosen end day', () => {
    const period = customPeriod(
      localDay(2026, 0, 12) + 15 * 3600_000,
      localDay(2026, 2, 31) + 11 * 3600_000,
    );
    expect(period.fromMs).toBe(localDay(2026, 0, 12));
    expect(period.toMs).toBe(localDay(2026, 3, 1));
    expect(period.label).toBe('12 Jan 2026 – 31 Mar 2026');
  });

  it('a single day is that whole day', () => {
    const period = customPeriod(localDay(2026, 5, 30), localDay(2026, 5, 30));
    expect(period.fromMs).toBe(localDay(2026, 5, 30));
    expect(period.toMs).toBe(localDay(2026, 6, 1));
  });

  it('picked out of order, the two days swap rather than yielding nothing', () => {
    const period = customPeriod(localDay(2026, 5, 30), localDay(2026, 4, 1));
    expect(period.fromMs).toBe(localDay(2026, 4, 1));
    expect(period.toMs).toBe(localDay(2026, 6, 1));
  });
});
