/**
 * Build a Google Calendar pre-filled "render" URL for a Job.
 *
 * Zero-backend escape hatch: tap → GCal opens with the event template
 * populated from the Job. Tradie tweaks whatever they want and saves in
 * GCal. Full OAuth-based sync (Phase 14) remains a later tranche.
 *
 * Duration is derived from the primary Document's labor (hours + unit) —
 * the tradie types it once, on the quote. Defaults to 1 day, 8h when no
 * doc is passed.
 */

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';
import { deriveDuration } from './deriveDuration';

const GCAL_RENDER = 'https://calendar.google.com/calendar/render';

/** YYYYMMDDTHHmmSSZ — GCal's template format. */
function gcalInstant(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear()}` +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/** YYYYMMDD — GCal all-day format. */
function gcalAllDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function computeEndMs(
  startMs: number,
  durationDays: number,
  hoursPerDay: number,
): number {
  const days = Math.max(1, durationDays);
  const hours = Math.max(1, hoursPerDay);
  const lastDayStart = new Date(startMs);
  lastDayStart.setDate(lastDayStart.getDate() + (days - 1));
  return lastDayStart.getTime() + hours * 60 * 60 * 1000;
}

function gcalDates(
  job: Job,
  durationDays: number,
  hoursPerDay: number,
): string | null {
  const start = job.scheduledStartDate;
  if (!start) return null;

  const startD = new Date(start);
  const isAllDay = startD.getHours() === 0 && startD.getMinutes() === 0;

  if (isAllDay) {
    const endD = new Date(start);
    endD.setDate(endD.getDate() + Math.max(1, durationDays)); // exclusive end
    return `${gcalAllDay(start)}/${gcalAllDay(endD.getTime())}`;
  }

  const explicitEnd =
    job.scheduledEndDate && job.scheduledEndDate > start
      ? job.scheduledEndDate
      : computeEndMs(start, durationDays, hoursPerDay);

  return `${gcalInstant(start)}/${gcalInstant(explicitEnd)}`;
}

function joinDetails(lines: Array<string | undefined | null>): string {
  return lines.filter((l): l is string => !!l && l.trim().length > 0).join('\n');
}

/**
 * Build the prefilled GCal render URL.
 *
 * @param job - The Job providing customer / address / time info.
 * @param doc - Optional primary Document — used to derive the event
 *   duration from quoted labor. Falls back to a 1-day, 8h window if
 *   omitted or labor info is missing.
 */
export function buildGoogleCalendarUrl(job: Job, doc?: Document): string {
  const { durationDays, hoursPerDay } = deriveDuration(doc);

  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set(
    'text',
    job.name
      ? `${job.name} — ${job.customerName || ''}`.trim().replace(/—\s*$/, '').trim()
      : 'Job',
  );

  const durationLine =
    durationDays > 1 || hoursPerDay !== 8
      ? `Duration: ${durationDays} day${durationDays === 1 ? '' : 's'} · ${hoursPerDay}h/day`
      : undefined;

  const details = joinDetails([
    job.description,
    durationLine,
    job.customerEmail ? `Email: ${job.customerEmail}` : undefined,
    job.customerPhone ? `Phone: ${job.customerPhone}` : undefined,
  ]);
  if (details) params.set('details', details);

  if (job.jobAddress) params.set('location', job.jobAddress);

  const dates = gcalDates(job, durationDays, hoursPerDay);
  if (dates) params.set('dates', dates);

  return `${GCAL_RENDER}?${params.toString()}`;
}
