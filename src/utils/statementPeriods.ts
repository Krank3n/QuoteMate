/**
 * Statement periods — the date ranges a tradie picks in Insights before
 * sending a statement to their accountant.
 *
 * Every boundary is computed in DEVICE LOCAL time via `new Date(y, m, d)`,
 * never UTC: "1 July" has to mean midnight where the tradie stands, because
 * that is the day the invoice carries. The range is half-open — `[fromMs,
 * toMs)` — which is the contract `shared/statement/buildStatement` reads, so
 * the last day of a period is the instant before `toMs`.
 *
 * The Australian financial year runs 1 July – 30 June. "Last FY" is the most
 * recent COMPLETED one, because an accountant is doing last year's return.
 */

import { format } from 'date-fns';

export type StatementPreset =
  | 'lastFinancialYear'
  | 'thisFinancialYearToDate'
  | 'lastQuarter'
  | 'custom';

/** The presets with boundaries the clock alone can work out. */
export type FixedStatementPreset = Exclude<StatementPreset, 'custom'>;

export interface StatementPeriod {
  /** Inclusive start, ms epoch, local midnight. */
  fromMs: number;
  /** Exclusive end, ms epoch, local midnight of the day after the last day. */
  toMs: number;
  /** Human range, e.g. "1 Jul 2025 – 30 Jun 2026". */
  label: string;
}

/** Chip copy, in the order Insights shows them. */
export const STATEMENT_PRESET_LABELS: Record<StatementPreset, string> = {
  lastFinancialYear: 'Last FY',
  thisFinancialYearToDate: 'This FY',
  lastQuarter: 'Last quarter',
  custom: 'Custom',
};

/**
 * What a screen reader should say. The chips are abbreviated so four of them
 * fit across a phone; "Last FY" read out letter by letter is not a period.
 */
export const STATEMENT_PRESET_LONG_LABELS: Record<StatementPreset, string> = {
  lastFinancialYear: 'Last financial year',
  thisFinancialYearToDate: 'This financial year so far',
  lastQuarter: 'Last quarter',
  custom: 'Custom dates',
};

/**
 * The device's IANA zone, or undefined where the runtime can't answer.
 *
 * The periods here are computed in local time, so the zone has to travel with
 * anything that prints or emails them. Intl is missing or throws on some
 * older Android builds — the same guard notificationService.getTimezone uses.
 */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Local midnight at the start of the given calendar day. */
function startOfLocalDay(year: number, month: number, day: number): number {
  return new Date(year, month, day).getTime();
}

/** The July the current financial year started in. */
function financialYearStartYear(now: Date): number {
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function labelFor(fromMs: number, toMs: number): string {
  // The end shown is the last day IN the period — toMs is exclusive.
  return `${format(new Date(fromMs), 'd MMM yyyy')} – ${format(new Date(toMs - 1), 'd MMM yyyy')}`;
}

function withLabel(fromMs: number, toMs: number): StatementPeriod {
  return { fromMs, toMs, label: labelFor(fromMs, toMs) };
}

export function statementPeriod(
  preset: FixedStatementPreset,
  now: number = Date.now(),
): StatementPeriod {
  const today = new Date(now);
  const fyStart = financialYearStartYear(today);

  switch (preset) {
    case 'lastFinancialYear':
      return withLabel(
        startOfLocalDay(fyStart - 1, 6, 1),
        startOfLocalDay(fyStart, 6, 1),
      );
    case 'thisFinancialYearToDate':
      // Through the end of today, so money taken this morning is in it.
      return withLabel(
        startOfLocalDay(fyStart, 6, 1),
        startOfLocalDay(today.getFullYear(), today.getMonth(), today.getDate() + 1),
      );
    case 'lastQuarter': {
      // Most recent COMPLETED calendar quarter. Jan–Mar rolls back a year.
      const previous = Math.floor(today.getMonth() / 3) - 1;
      const year = previous < 0 ? today.getFullYear() - 1 : today.getFullYear();
      const startMonth = (previous < 0 ? 3 : previous) * 3;
      return withLabel(
        startOfLocalDay(year, startMonth, 1),
        startOfLocalDay(year, startMonth + 3, 1),
      );
    }
  }
}

/**
 * A range from two days picked on the calendar. The start snaps back to local
 * midnight and the end forward to the start of the day AFTER the one chosen,
 * so picking 30 June as the end includes everything recorded on 30 June.
 *
 * Picked out of order (the end sheet opens second, but a tradie can fix the
 * start afterwards), the two swap rather than yielding an empty period.
 */
export function customPeriod(fromDayMs: number, toDayMs: number): StatementPeriod {
  const first = Math.min(fromDayMs, toDayMs);
  const last = Math.max(fromDayMs, toDayMs);
  const start = new Date(first);
  const end = new Date(last);
  return withLabel(
    startOfLocalDay(start.getFullYear(), start.getMonth(), start.getDate()),
    startOfLocalDay(end.getFullYear(), end.getMonth(), end.getDate() + 1),
  );
}
