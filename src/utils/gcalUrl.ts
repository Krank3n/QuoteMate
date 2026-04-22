/**
 * Build a Google Calendar pre-filled "render" URL for a Job.
 *
 * The zero-backend escape hatch: tap the link, GCal opens with the event
 * template populated from the Job. Tradie tweaks whatever they want and
 * hits save in GCal.
 *
 * Full OAuth-based sync (Phase 14) remains a later tranche — when it
 * lands, event creation moves server-side and this helper becomes the
 * fallback for users who haven't connected a Google account.
 */

import type { Job } from '../../shared/job/types';

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

/**
 * Compute the event end timestamp from start + duration days + hours/day.
 *  - Single day, timed: start + hoursPerDay (or 2h fallback).
 *  - Multi-day, timed: last day's start time + hoursPerDay
 *    (event spans Mon 9am → Wed 5pm, GCal renders it as a 3-day block —
 *    matches how a tradie thinks about "I'm on this job Mon to Wed").
 */
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

/**
 * Build dates=... query value for the GCal render URL.
 *  - All-day event (no time set): dates=YYYYMMDD/YYYYMMDD+1 — GCal end is
 *    exclusive, so a 1-day all-day event uses tomorrow as the end.
 *  - Timed event: dates=YYYYMMDDTHHmmSSZ/YYYYMMDDTHHmmSSZ across the
 *    duration window.
 */
function gcalDates(job: Job): string | null {
  const start = job.scheduledStartDate;
  if (!start) return null;

  const startD = new Date(start);
  const isAllDay = startD.getHours() === 0 && startD.getMinutes() === 0;
  const days = Math.max(1, Number(job.scheduledDurationDays) || 1);
  const hoursPerDay = Math.max(1, Number(job.scheduledHoursPerDay) || 8);

  if (isAllDay) {
    const endD = new Date(start);
    endD.setDate(endD.getDate() + days); // exclusive end
    return `${gcalAllDay(start)}/${gcalAllDay(endD.getTime())}`;
  }

  const explicitEnd =
    job.scheduledEndDate && job.scheduledEndDate > start
      ? job.scheduledEndDate
      : computeEndMs(start, days, hoursPerDay);

  return `${gcalInstant(start)}/${gcalInstant(explicitEnd)}`;
}

function joinDetails(lines: Array<string | undefined | null>): string {
  return lines.filter((l): l is string => !!l && l.trim().length > 0).join('\n');
}

export function buildGoogleCalendarUrl(job: Job): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set(
    'text',
    job.name
      ? `${job.name} — ${job.customerName || ''}`.trim().replace(/—\s*$/, '').trim()
      : 'Job',
  );

  const days = Math.max(1, Number(job.scheduledDurationDays) || 1);
  const hoursPerDay = Math.max(1, Number(job.scheduledHoursPerDay) || 8);
  const durationLine =
    days === 1 && !job.scheduledHoursPerDay
      ? undefined
      : `Duration: ${days} day${days === 1 ? '' : 's'} · ${hoursPerDay}h/day`;

  const details = joinDetails([
    job.description,
    durationLine,
    job.customerEmail ? `Email: ${job.customerEmail}` : undefined,
    job.customerPhone ? `Phone: ${job.customerPhone}` : undefined,
  ]);
  if (details) params.set('details', details);

  if (job.jobAddress) params.set('location', job.jobAddress);

  const dates = gcalDates(job);
  if (dates) params.set('dates', dates);

  return `${GCAL_RENDER}?${params.toString()}`;
}
